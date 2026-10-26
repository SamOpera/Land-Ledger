// An in-browser copy of the LandLedger contract. Same rules, same errors, same events,
// so anyone can try the full flow without a wallet or test ETH.
import {
  Actions,
  ChainEvent,
  ChainState,
  ContractError,
  Parcel,
  PlanStatus,
  ZERO,
  ZERO_HASH,
  isAddress,
  normalizePlan,
  planHash,
  same,
  short,
} from "./chain";

export const demoAccounts = {
  bureau: { name: "Land bureau", address: "0x3F8a91C2d7E04b6A5c19e83D2f7B0a64E1c5d920" },
  registrar: { name: "Funke (registrar)", address: "0x81D4e7A2b9C03f56E1a8D74c2B9e0F35a6d7C148" },
  ada: { name: "Ada (landowner)", address: "0x4b2E8c19F3a7D60e5B91c24A7f3E0d58C6a219a0" },
  bola: { name: "Bola (buyer)", address: "0x9c71A5e3D02f8B46c1E9a7F3b50D2e84C7f1e5d3" },
} as const;

export type DemoAccount = keyof typeof demoAccounts;

function fakeHash() {
  let h = "0x";
  for (let i = 0; i < 64; i++) h += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  return h;
}

const sampleDoc = (s: string) => planHash(`doc:${s}`);

export class DemoChain {
  private state: ChainState;
  private block = 7_820_400;
  private listeners = new Set<() => void>();
  private as: DemoAccount = "bureau";

  constructor() {
    const { bureau, registrar, ada, bola } = demoAccounts;
    this.state = { bureau: bureau.address, registrars: [], plans: [], parcels: [], events: [] };
    // A believable starting history.
    const run = (who: DemoAccount, fn: () => void) => {
      this.as = who;
      fn();
    };
    run("bureau", () => {
      this.doSetRegistrar(registrar.address, true);
      ["LA/1234/2024", "LA/2051/2024", "OY/0877/2023", "LA/3310/2025"].forEach((p) => this.doApprovePlan(p));
    });
    run("registrar", () => {
      this.doRegister(ada.address, "LA/1234/2024", sampleDoc("lekki"), "Plot 12, Block C, Lekki Phase 1, Lagos", 648);
      this.doRegister(bola.address, "OY/0877/2023", sampleDoc("oyo"), "Farmland off Iseyin Road, Oyo", 12_000);
      this.doRegister(ada.address, "LA/2051/2024", sampleDoc("ikeja"), "No. 7 Allen Avenue, Ikeja, Lagos", 450);
    });
    run("ada", () => this.doPropose(3, bola.address));
    run("registrar", () => this.doApproveTransfer(3));
    run("registrar", () => this.doFlag(2, "Family claims part of the farmland"));
    this.as = "bureau";
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getState(): ChainState {
    return this.state;
  }

  setAccount(a: DemoAccount) {
    this.as = a;
  }

  private sender() {
    return demoAccounts[this.as].address;
  }

  // ---- internal state machine, mirroring LandLedger.sol ----

  private emit(name: string, parcelId: number | null, detail: string) {
    const ev: ChainEvent = { key: `${this.block}-${this.state.events.length}`, block: ++this.block, name, parcelId, detail, txHash: fakeHash() };
    this.state = { ...this.state, events: [ev, ...this.state.events].slice(0, 60) };
    return ev.txHash;
  }

  private patch(id: number, p: Partial<Parcel>) {
    this.state = { ...this.state, parcels: this.state.parcels.map((x) => (x.id === id ? { ...x, ...p } : x)) };
  }

  private get(id: number) {
    const p = this.state.parcels.find((x) => x.id === id);
    if (!p) throw new ContractError("UnknownParcel");
    return p;
  }

  private onlyBureau() {
    if (!same(this.sender(), this.state.bureau)) throw new ContractError("NotBureau");
  }

  private onlyRegistrar() {
    if (!this.state.registrars.some((r) => same(r, this.sender()))) throw new ContractError("NotRegistrar");
  }

  private doSetRegistrar(registrar: string, active: boolean) {
    this.onlyBureau();
    if (!isAddress(registrar) || registrar === ZERO) throw new ContractError("ZeroAddress");
    const rest = this.state.registrars.filter((r) => !same(r, registrar));
    this.state = { ...this.state, registrars: active ? [...rest, registrar] : rest };
    return this.emit("RegistrarSet", null, `${short(registrar)} ${active ? "appointed" : "removed"}`);
  }

  private doApprovePlan(planNumber: string) {
    this.onlyBureau();
    const label = normalizePlan(planNumber);
    if (!label) throw new ContractError("EmptyValue");
    const hash = planHash(label);
    if (this.state.plans.some((p) => p.hash === hash)) throw new ContractError("PlanAlreadyKnown");
    this.state = { ...this.state, plans: [...this.state.plans, { hash, label, status: PlanStatus.Approved }] };
    return this.emit("SurveyPlanApproved", null, label);
  }

  private doRegister(owner: string, planNumber: string, documentHash: string, location: string, areaSqm: number) {
    this.onlyRegistrar();
    if (!isAddress(owner) || owner === ZERO) throw new ContractError("ZeroAddress");
    if (!documentHash || documentHash === ZERO_HASH || !location.trim() || !(areaSqm > 0)) throw new ContractError("EmptyValue");
    const hash = planHash(planNumber);
    const plan = this.state.plans.find((p) => p.hash === hash);
    if (plan?.status === PlanStatus.Used) throw new ContractError("PlanUsed");
    if (!plan || plan.status !== PlanStatus.Approved) throw new ContractError("PlanNotApproved");
    const id = this.state.parcels.length + 1;
    const parcel: Parcel = {
      id,
      owner,
      surveyPlan: hash,
      documentHash,
      location: location.trim(),
      areaSqm: Math.floor(areaSqm),
      registeredAt: Math.floor(Date.now() / 1000),
      pendingBuyer: ZERO,
      disputed: false,
      transfers: 0,
    };
    this.state = {
      ...this.state,
      plans: this.state.plans.map((p) => (p.hash === hash ? { ...p, status: PlanStatus.Used } : p)),
      parcels: [...this.state.parcels, parcel],
    };
    return this.emit("ParcelRegistered", id, `to ${short(owner)}, ${parcel.location}`);
  }

  private doPropose(id: number, to: string) {
    const p = this.get(id);
    if (!same(this.sender(), p.owner)) throw new ContractError("NotOwner");
    if (!isAddress(to) || to === ZERO) throw new ContractError("ZeroAddress");
    if (same(to, p.owner)) throw new ContractError("SelfTransfer");
    if (p.disputed) throw new ContractError("UnderDispute");
    if (p.pendingBuyer !== ZERO) throw new ContractError("TransferPending");
    this.patch(id, { pendingBuyer: to });
    return this.emit("TransferProposed", id, `${short(p.owner)} offered it to ${short(to)}`);
  }

  private doCancel(id: number) {
    const p = this.get(id);
    if (!same(this.sender(), p.owner)) throw new ContractError("NotOwner");
    if (p.pendingBuyer === ZERO) throw new ContractError("NoPendingTransfer");
    this.patch(id, { pendingBuyer: ZERO });
    return this.emit("TransferCancelled", id, "sale withdrawn by the owner");
  }

  private doApproveTransfer(id: number) {
    this.onlyRegistrar();
    const p = this.get(id);
    if (p.pendingBuyer === ZERO) throw new ContractError("NoPendingTransfer");
    if (p.disputed) throw new ContractError("UnderDispute");
    this.patch(id, { owner: p.pendingBuyer, pendingBuyer: ZERO, transfers: p.transfers + 1 });
    return this.emit("TransferApproved", id, `${short(p.owner)} → ${short(p.pendingBuyer)}`);
  }

  private doFlag(id: number, reason: string) {
    this.onlyRegistrar();
    this.get(id);
    if (!reason.trim()) throw new ContractError("EmptyValue");
    this.patch(id, { disputed: true });
    return this.emit("DisputeFlagged", id, reason.trim());
  }

  private doClear(id: number, resolution: string) {
    this.onlyRegistrar();
    const p = this.get(id);
    if (!p.disputed) throw new ContractError("NotDisputed");
    this.patch(id, { disputed: false });
    return this.emit("DisputeCleared", id, resolution.trim() || "cleared");
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  /** The same Actions the live contract exposes, with a short fake mining delay. */
  actions(delayMs = 650): Actions {
    const tx = (fn: () => string) =>
      new Promise<string>((resolve, reject) =>
        setTimeout(() => {
          try {
            const hash = fn();
            this.notify();
            resolve(hash);
          } catch (e) {
            reject(e);
          }
        }, delayMs)
      );
    return {
      setRegistrar: (r, active) => tx(() => this.doSetRegistrar(r.trim(), active)),
      approveSurveyPlan: (plan) => tx(() => this.doApprovePlan(plan)),
      registerParcel: (owner, plan, doc, loc, area) => tx(() => this.doRegister(owner.trim(), plan, doc, loc, area)),
      proposeTransfer: (id, to) => tx(() => this.doPropose(id, to.trim())),
      cancelTransfer: (id) => tx(() => this.doCancel(id)),
      approveTransfer: (id) => tx(() => this.doApproveTransfer(id)),
      flagDispute: (id, reason) => tx(() => this.doFlag(id, reason)),
      clearDispute: (id, res) => tx(() => this.doClear(id, res)),
    };
  }
}
