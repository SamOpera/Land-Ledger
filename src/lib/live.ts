// The real LandLedger contract on Ethereum Sepolia. Reads go through a public RPC so
// anyone can verify a title without a wallet; writes go through the visitor's wallet.
import { BrowserProvider, Contract, Interface, JsonRpcProvider, Signer, isError } from "ethers";
import { Actions, ChainEvent, ChainState, ContractError, Parcel, Plan, PlanStatus, planHash, short } from "./chain";

export const SEPOLIA = {
  chainId: 11155111,
  hexId: "0xaa36a7",
  name: "Sepolia",
  rpc: process.env.NEXT_PUBLIC_SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com",
  explorer: "https://sepolia.etherscan.io",
};

// The public Sepolia deployment. Empty until the contract is deployed; environment
// variables override it, for example to point a fork at your own deployment.
const DEFAULT_ADDRESS = "";
const DEFAULT_DEPLOY_BLOCK = 0;

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_LANDLEDGER_ADDRESS || DEFAULT_ADDRESS;
const DEPLOY_BLOCK = Number(process.env.NEXT_PUBLIC_LANDLEDGER_DEPLOY_BLOCK || DEFAULT_DEPLOY_BLOCK);

export const isDeployed = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);

export const ABI = [
  "error EmptyValue()",
  "error NoPendingTransfer()",
  "error NotBureau()",
  "error NotDisputed()",
  "error NotOwner()",
  "error NotRegistrar()",
  "error PlanAlreadyKnown()",
  "error PlanNotApproved(uint8 current)",
  "error SelfTransfer()",
  "error TransferPending()",
  "error UnderDispute()",
  "error UnknownParcel()",
  "error ZeroAddress()",
  "event RegistrarSet(address indexed registrar, bool active)",
  "event SurveyPlanApproved(bytes32 indexed surveyPlan)",
  "event ParcelRegistered(uint256 indexed id, address indexed owner, bytes32 indexed surveyPlan, string location, uint64 areaSqm, bytes32 documentHash, address registrar)",
  "event TransferProposed(uint256 indexed id, address indexed from, address indexed to)",
  "event TransferCancelled(uint256 indexed id)",
  "event TransferApproved(uint256 indexed id, address indexed from, address indexed to, address registrar)",
  "event DisputeFlagged(uint256 indexed id, string reason, address registrar)",
  "event DisputeCleared(uint256 indexed id, string resolution, address registrar)",
  "function bureau() view returns (address)",
  "function parcelCount() view returns (uint256)",
  "function isRegistrar(address) view returns (bool)",
  "function planStatus(bytes32) view returns (uint8)",
  "function parcelOfPlan(bytes32) view returns (uint256)",
  "function getParcel(uint256 id) view returns ((address owner, bytes32 surveyPlan, bytes32 documentHash, string location, uint64 areaSqm, uint64 registeredAt, address pendingBuyer, bool disputed, uint32 transfers))",
  "function verify(uint256 id) view returns (address owner, bool disputed, bool transferPending, uint32 transfers)",
  "function setRegistrar(address registrar, bool active)",
  "function approveSurveyPlan(bytes32 surveyPlan)",
  "function registerParcel(address owner, bytes32 surveyPlan, bytes32 documentHash, string location, uint64 areaSqm) returns (uint256 id)",
  "function proposeTransfer(uint256 id, address to)",
  "function cancelTransfer(uint256 id)",
  "function approveTransfer(uint256 id)",
  "function flagDispute(uint256 id, string reason)",
  "function clearDispute(uint256 id, string resolution)",
];

const iface = new Interface(ABI);

function describe(name: string, a: Record<string, unknown>): string {
  switch (name) {
    case "RegistrarSet":
      return `${short(String(a.registrar))} ${a.active ? "appointed" : "removed"}`;
    case "SurveyPlanApproved":
      return `plan ${String(a.surveyPlan).slice(0, 10)}…`;
    case "ParcelRegistered":
      return `to ${short(String(a.owner))}, ${a.location}`;
    case "TransferProposed":
      return `${short(String(a.from))} offered it to ${short(String(a.to))}`;
    case "TransferCancelled":
      return "sale withdrawn by the owner";
    case "TransferApproved":
      return `${short(String(a.from))} → ${short(String(a.to))}`;
    case "DisputeFlagged":
      return String(a.reason);
    case "DisputeCleared":
      return String(a.resolution) || "cleared";
    default:
      return "";
  }
}

/** Turn a wallet or RPC error into one of the contract's own error names. */
export function toContractError(e: unknown): Error {
  const data =
    (e as { data?: string })?.data ??
    (e as { info?: { error?: { data?: string } } })?.info?.error?.data ??
    (e as { error?: { data?: string } })?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return new ContractError(parsed.name);
    } catch {
      /* not one of ours */
    }
  }
  if (isError(e, "ACTION_REJECTED")) return new Error("You cancelled the transaction in your wallet.");
  if (isError(e, "INSUFFICIENT_FUNDS")) return new Error("Your wallet doesn’t have enough Sepolia ETH for gas.");
  return e instanceof Error ? e : new Error(String(e));
}

export function readProvider() {
  return new JsonRpcProvider(SEPOLIA.rpc, SEPOLIA.chainId, { staticNetwork: true });
}

export async function readState(provider = readProvider(), address = CONTRACT_ADDRESS): Promise<ChainState> {
  const c = new Contract(address, ABI, provider);
  const [bureau, count, latest] = await Promise.all([
    c.bureau() as Promise<string>,
    c.parcelCount() as Promise<bigint>,
    provider.getBlockNumber(),
  ]);
  const ids = Array.from({ length: Number(count) }, (_, i) => i + 1);
  const raw = await Promise.all(ids.map((id) => c.getParcel(id)));
  const parcels: Parcel[] = raw.map((p, i) => ({
    id: ids[i],
    owner: p.owner,
    surveyPlan: p.surveyPlan,
    documentHash: p.documentHash,
    location: p.location,
    areaSqm: Number(p.areaSqm),
    registeredAt: Number(p.registeredAt),
    pendingBuyer: p.pendingBuyer,
    disputed: p.disputed,
    transfers: Number(p.transfers),
  }));

  // Registrars and plans are rebuilt from the event log. The parcels above already
  // carry the full current state, so a log query that fails only hides history.
  const from = DEPLOY_BLOCK > 0 ? DEPLOY_BLOCK : Math.max(0, latest - 45_000);
  const events: ChainEvent[] = [];
  const registrars = new Map<string, boolean>();
  const plans = new Map<string, Plan>();
  try {
    const logs = await provider.getLogs({ address, fromBlock: from, toBlock: latest });
    logs.forEach((log, i) => {
      const parsed = iface.parseLog(log);
      if (!parsed) return;
      const a = Object.fromEntries(parsed.fragment.inputs.map((inp, j) => [inp.name, parsed.args[j]]));
      if (parsed.name === "RegistrarSet") registrars.set(String(a.registrar), Boolean(a.active));
      if (parsed.name === "SurveyPlanApproved") plans.set(String(a.surveyPlan), { hash: String(a.surveyPlan), status: PlanStatus.Approved });
      if (parsed.name === "ParcelRegistered") plans.set(String(a.surveyPlan), { hash: String(a.surveyPlan), status: PlanStatus.Used });
      events.push({
        key: `${log.blockNumber}-${log.index ?? i}`,
        block: log.blockNumber,
        name: parsed.name,
        parcelId: a.id !== undefined ? Number(a.id) : null,
        detail: describe(parsed.name, a),
        txHash: log.transactionHash,
      });
    });
  } catch {
    /* Some public RPCs limit log queries. */
  }
  return {
    bureau,
    registrars: [...registrars].filter(([, on]) => on).map(([r]) => r),
    plans: [...plans.values()],
    parcels,
    events: events.reverse().slice(0, 60),
  };
}

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export function injected(): Eip1193 | null {
  return typeof window !== "undefined" ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null;
}

export async function connectWallet(): Promise<{ signer: Signer; address: string }> {
  const eth = injected();
  if (!eth) throw new Error("No wallet found. Install MetaMask, or use the demo mode.");
  await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA.hexId }] });
  } catch {
    throw new Error("Switch your wallet to the Sepolia test network and try again.");
  }
  const provider = new BrowserProvider(eth as never);
  const signer = await provider.getSigner();
  return { signer, address: await signer.getAddress() };
}

/** Write actions through a signer. Each one waits for the transaction to be mined. */
export function liveActions(signer: Signer, address = CONTRACT_ADDRESS): Actions {
  const c = new Contract(address, ABI, signer);
  const send = async (fn: () => Promise<{ hash: string; wait(): Promise<unknown> }>) => {
    try {
      const tx = await fn();
      await tx.wait();
      return tx.hash;
    } catch (e) {
      throw toContractError(e);
    }
  };
  return {
    setRegistrar: (r, active) => send(() => c.setRegistrar(r.trim(), active)),
    approveSurveyPlan: (plan) => send(() => c.approveSurveyPlan(planHash(plan))),
    registerParcel: (owner, plan, doc, loc, area) =>
      send(() => c.registerParcel(owner.trim(), planHash(plan), doc, loc.trim(), BigInt(Math.floor(area)))),
    proposeTransfer: (id, to) => send(() => c.proposeTransfer(id, to.trim())),
    cancelTransfer: (id) => send(() => c.cancelTransfer(id)),
    approveTransfer: (id) => send(() => c.approveTransfer(id)),
    flagDispute: (id, reason) => send(() => c.flagDispute(id, reason)),
    clearDispute: (id, res) => send(() => c.clearDispute(id, res)),
  };
}
