"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Signer } from "ethers";

import {
  Actions,
  ChainEvent,
  ChainState,
  Parcel,
  PlanStatus,
  ZERO,
  fileHash,
  isAddress,
  isHash,
  lookup,
  same,
  short,
  titleStatus,
} from "@/lib/chain";
import { DemoAccount, DemoChain, demoAccounts } from "@/lib/demo";
import { CONTRACT_ADDRESS, SEPOLIA, connectWallet, isDeployed, liveActions, readState } from "@/lib/live";
import { Mark } from "./Mark";

type Mode = "demo" | "live";
type Toast = { text: string; err?: boolean; href?: string } | null;

const REPO = "https://github.com/SamOpera/land-ledger";

const eventLabel: Record<string, string> = {
  RegistrarSet: "Registrar",
  SurveyPlanApproved: "Plan approved",
  ParcelRegistered: "Registered",
  TransferProposed: "Sale offered",
  TransferCancelled: "Sale withdrawn",
  TransferApproved: "Ownership moved",
  DisputeFlagged: "Dispute flagged",
  DisputeCleared: "Dispute cleared",
};

const statusCopy = {
  clear: { label: "Clear title", text: "Registered, no dispute and no other sale in progress." },
  pending: { label: "Sale in progress", text: "The owner has already offered this land to someone. Don’t pay until that sale is approved or withdrawn." },
  disputed: { label: "Under dispute", text: "A registrar has frozen this parcel. It can’t change hands until the dispute is cleared." },
} as const;

const fmtArea = (m2: number) => (m2 >= 10_000 ? `${(m2 / 10_000).toLocaleString("en-NG", { maximumFractionDigits: 2 })} ha` : `${m2.toLocaleString("en-NG")} m²`);
const fmtDate = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function App() {
  const demo = useMemo(() => new DemoChain(), []);
  const demoState = useSyncExternalStore(
    useCallback((fn) => demo.subscribe(fn), [demo]),
    () => demo.getState(),
    () => demo.getState()
  );

  const [mode, setMode] = useState<Mode>("demo");
  const [who, setWho] = useState<DemoAccount>("ada");
  const [live, setLive] = useState<ChainState | null>(null);
  const [liveErr, setLiveErr] = useState("");
  const [wallet, setWallet] = useState<{ signer: Signer; address: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Parcel | null | undefined>(undefined);
  const [asked, setAsked] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => demo.setAccount(who), [demo, who]);

  const state = mode === "demo" ? demoState : live;
  const me = mode === "demo" ? demoAccounts[who].address : (wallet?.address ?? "");

  const refreshLive = useCallback(async () => {
    try {
      setLive(await readState());
      setLiveErr("");
    } catch (e) {
      setLiveErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (mode === "live" && isDeployed) void refreshLive();
  }, [mode, refreshLive]);

  // Keep the verified parcel in step with the chain after every change.
  const shown = found ? (state?.parcels.find((p) => p.id === found.id) ?? found) : found;

  const say = (t: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t?.err ? 6500 : 4200);
  };

  const actions: Actions | null = mode === "demo" ? demo.actions() : wallet ? liveActions(wallet.signer) : null;

  async function run(label: string, fn: (a: Actions) => Promise<string>) {
    if (!actions) return say({ text: "Connect your wallet first.", err: true });
    setBusy(label);
    try {
      const hash = await fn(actions);
      if (mode === "live") await refreshLive();
      say({ text: `${label}: done.`, href: mode === "live" ? `${SEPOLIA.explorer}/tx/${hash}` : undefined });
      return true;
    } catch (e) {
      say({ text: e instanceof Error ? e.message : String(e), err: true });
      return false;
    } finally {
      setBusy("");
    }
  }

  function verify(q = query) {
    setQuery(q);
    setAsked(q.trim());
    setFound(state ? lookup(state.parcels, q) : null);
  }

  function switchMode(m: Mode) {
    setMode(m);
    setFound(undefined);
    setAsked("");
  }

  async function connect() {
    try {
      setWallet(await connectWallet());
    } catch (e) {
      say({ text: e instanceof Error ? e.message : String(e), err: true });
    }
  }

  const isBureau = !!state && !!me && same(state.bureau, me);
  const isRegistrar = !!state && !!me && state.registrars.some((r) => same(r, me));
  const mine = state && me ? state.parcels.filter((p) => same(p.owner, me)) : [];

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#top">
          <Mark />
          Land-Ledger
        </a>
        <div className="top__right">
          <div className="seg" role="tablist" aria-label="Network">
            <button role="tab" aria-selected={mode === "demo"} className={mode === "demo" ? "is-on" : ""} onClick={() => switchMode("demo")}>
              Demo
            </button>
            <button
              role="tab"
              aria-selected={mode === "live"}
              className={mode === "live" ? "is-on" : ""}
              onClick={() => switchMode("live")}
              disabled={!isDeployed}
              title={isDeployed ? "The real contract on Sepolia" : "Not deployed yet"}
            >
              Sepolia
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="intro">
          <p className="kicker">On-chain land titles · Ethereum</p>
          <h1>
            <span>Check a land title</span> before you pay.
          </h1>
          <p className="lead">
            Land fraud usually means the same plot sold twice, or sold by someone who doesn’t own it. On Land-Ledger
            each survey plan can be registered once, land moves only when the owner offers it and a registrar approves,
            and anyone can check a title for free.
          </p>
          {mode === "demo" && (
            <p className="note">
              <strong>Demo mode.</strong> This is an in-browser copy of the contract with the same rules and errors.
              Nothing touches a real network, so try anything.
            </p>
          )}
          {mode === "live" && (
            <p className="note">
              <strong>Live on Sepolia.</strong> Reading{" "}
              <a href={`${SEPOLIA.explorer}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
                {short(CONTRACT_ADDRESS)}
              </a>{" "}
              through a public node. Verifying needs no wallet.
              {liveErr && <span className="note__err"> Couldn’t reach the network: {liveErr}</span>}
            </p>
          )}
        </section>

        <section className="verify" aria-labelledby="verify-h">
          <h2 id="verify-h">Verify a title</h2>
          <form
            className="verify__form"
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <label className="sr" htmlFor="q">
              Parcel number or survey plan number
            </label>
            <input id="q" className="input input--lg" placeholder="Parcel number or survey plan, e.g. LA/1234/2024" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <button className="btn btn--gold" type="submit" disabled={!state}>
              Verify
            </button>
          </form>
          {mode === "demo" && (
            <p className="try">
              Try:{" "}
              {["LA/1234/2024", "2", "3", "LA/9999/2024"].map((s) => (
                <button key={s} type="button" className="link" onClick={() => verify(s)}>
                  {s}
                </button>
              ))}
            </p>
          )}

          {found === null && (
            <div className="result result--none" role="status">
              <strong>Nothing registered for “{asked}”.</strong>
              <p>
                If someone is selling you this land, ask why it isn’t on the ledger before you pay anything. A real
                title has a parcel number and an approved survey plan.
              </p>
            </div>
          )}
          {shown && state && <TitleCard parcel={shown} events={state.events.filter((e) => e.parcelId === shown.id)} live={mode === "live"} />}
        </section>

        <section className="desk" aria-labelledby="desk-h">
          <div className="desk__head">
            <h2 id="desk-h">Work the ledger</h2>
            {mode === "demo" ? (
              <div className="as">
                <span>Acting as</span>
                <div className="seg seg--wide" role="radiogroup" aria-label="Demo account">
                  {(Object.keys(demoAccounts) as DemoAccount[]).map((k) => (
                    <button key={k} role="radio" aria-checked={who === k} className={who === k ? "is-on" : ""} onClick={() => setWho(k)}>
                      {demoAccounts[k].name}
                    </button>
                  ))}
                </div>
              </div>
            ) : wallet ? (
              <span className="chip">
                <i /> {short(wallet.address)}
                {isBureau ? " · bureau" : isRegistrar ? " · registrar" : ""}
              </span>
            ) : (
              <button className="btn btn--light btn--sm" onClick={connect}>
                Connect wallet
              </button>
            )}
          </div>

          {busy && (
            <p className="busy" role="status">
              <span className="spin" /> {busy}…{mode === "live" ? " confirm in your wallet, then wait for the block." : ""}
            </p>
          )}

          {state && (
            <div className="panels">
              {isBureau && <BureauPanel state={state} busy={!!busy} run={run} />}
              {isRegistrar && <RegistrarPanel state={state} busy={!!busy} run={run} />}
              <OwnerPanel me={me} mine={mine} busy={!!busy} run={run} connected={mode === "demo" || !!wallet} />
            </div>
          )}
        </section>

        {state && (
          <section className="registry" aria-labelledby="reg-h">
            <h2 id="reg-h">The register</h2>
            <div className="grid2">
              <div className="table" role="table" aria-label="Registered parcels">
                <div className="tr th" role="row">
                  <span role="columnheader">#</span>
                  <span role="columnheader">Location</span>
                  <span role="columnheader">Owner</span>
                  <span role="columnheader">Status</span>
                </div>
                {state.parcels.length === 0 && <p className="empty">No parcels registered yet.</p>}
                {[...state.parcels].reverse().map((p) => {
                  const s = titleStatus(p);
                  return (
                    <button key={p.id} className="tr" role="row" onClick={() => verify(String(p.id))}>
                      <span role="cell" className="mono">{p.id}</span>
                      <span role="cell" className="ellip">{p.location}</span>
                      <span role="cell" className="mono">{short(p.owner)}</span>
                      <span role="cell">
                        <b className={`badge badge--${s}`}>{statusCopy[s].label}</b>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="feed">
                <h3>Activity</h3>
                <Feed events={state.events.slice(0, 12)} live={mode === "live"} />
              </div>
            </div>
          </section>
        )}

        <section className="how" aria-labelledby="how-h">
          <h2 id="how-h">Why this stops double sales</h2>
          <ol>
            <li>
              <strong>One plan, one parcel.</strong> The bureau approves each survey plan, and a plan can be registered
              exactly once. A second registration on the same plan is refused by the contract.
            </li>
            <li>
              <strong>Two keys to move land.</strong> The owner offers the parcel to a buyer, then a registrar approves.
              Neither can move land alone, and only one sale can be open at a time.
            </li>
            <li>
              <strong>Disputes freeze the title.</strong> A registrar can flag a claim, and nothing moves until it is
              cleared. Buyers see the flag when they verify.
            </li>
            <li>
              <strong>No personal data on-chain.</strong> Deeds stay off-chain. The ledger keeps only their hash, so a
              buyer can check the papers they were handed match the registered ones.
            </li>
          </ol>
        </section>
      </main>

      <footer className="foot">
        <span>
          Built by{" "}
          <a href="https://samsonolakeye.com" target="_blank" rel="noreferrer">
            Samson Olakeye
          </a>
        </span>
        <span>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source and tests on GitHub
          </a>
        </span>
      </footer>

      {mode === "demo" && (
        <datalist id="accounts">
          {Object.values(demoAccounts).map((a) => (
            <option key={a.address} value={a.address}>
              {a.name}
            </option>
          ))}
        </datalist>
      )}

      <div className={`toast ${toast ? "is-on" : ""} ${toast?.err ? "is-err" : ""}`} role="status" aria-live="polite">
        {toast?.text}
        {toast?.href && (
          <>
            {" "}
            <a href={toast.href} target="_blank" rel="noreferrer">
              View on Etherscan
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function TitleCard({ parcel: p, events, live }: { parcel: Parcel; events: ChainEvent[]; live: boolean }) {
  const s = titleStatus(p);
  const [docCheck, setDocCheck] = useState<"match" | "nomatch" | null>(null);

  useEffect(() => setDocCheck(null), [p.id]);

  async function check(file?: File) {
    if (!file) return;
    setDocCheck((await fileHash(file)) === p.documentHash ? "match" : "nomatch");
  }

  return (
    <article className={`result result--${s}`} aria-live="polite">
      <div className="result__head">
        <div>
          <p className="result__id">Parcel #{p.id}</p>
          <h3>{p.location}</h3>
        </div>
        <b className={`badge badge--${s} badge--lg`}>{statusCopy[s].label}</b>
      </div>
      <p className="result__say">{statusCopy[s].text}</p>
      <dl className="facts">
        <div>
          <dt>Owner</dt>
          <dd className="mono">{p.owner}</dd>
        </div>
        {p.pendingBuyer !== ZERO && (
          <div>
            <dt>Offered to</dt>
            <dd className="mono">{p.pendingBuyer}</dd>
          </div>
        )}
        <div>
          <dt>Area</dt>
          <dd>{fmtArea(p.areaSqm)}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{fmtDate(p.registeredAt)}</dd>
        </div>
        <div>
          <dt>Times sold</dt>
          <dd>{p.transfers}</dd>
        </div>
        <div>
          <dt>Document hash</dt>
          <dd className="mono ellip" title={p.documentHash}>
            {p.documentHash}
          </dd>
        </div>
      </dl>
      <label className="drop">
        <input type="file" onChange={(e) => check(e.target.files?.[0])} />
        <span>
          <strong>Check the deed you were given.</strong> Choose the file and it is hashed on your device, never
          uploaded.
        </span>
      </label>
      {docCheck === "match" && <p className="doc doc--ok">This file matches the registered documents.</p>}
      {docCheck === "nomatch" && (
        <p className="doc doc--bad">This file does not match the registered documents. Ask for the original before paying.</p>
      )}
      {events.length > 0 && (
        <div className="history">
          <h4>Title history</h4>
          <Feed events={events} live={live} />
        </div>
      )}
    </article>
  );
}

function Feed({ events, live }: { events: ChainEvent[]; live: boolean }) {
  if (events.length === 0) return <p className="empty">No activity yet.</p>;
  return (
    <ul className="events">
      {events.map((e) => (
        <li key={e.key}>
          <span className="events__name">
            {eventLabel[e.name] ?? e.name}
            {e.parcelId ? <em> #{e.parcelId}</em> : null}
          </span>
          <span className="events__detail">{e.detail}</span>
          {live ? (
            <a className="mono" href={`${SEPOLIA.explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
              {e.block}
            </a>
          ) : (
            <span className="mono">{e.block}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

type Run = (label: string, fn: (a: Actions) => Promise<string>) => Promise<boolean | void>;

function BureauPanel({ state, busy, run }: { state: ChainState; busy: boolean; run: Run }) {
  const [registrar, setRegistrar] = useState("");
  const [plan, setPlan] = useState("");
  const approved = state.plans.filter((p) => p.status === PlanStatus.Approved);
  return (
    <div className="panel">
      <h3>Land bureau</h3>
      <p className="panel__say">Appoints registrars and approves survey plans. Each plan can then be registered once.</p>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("Approve survey plan", (a) => a.approveSurveyPlan(plan))) setPlan("");
        }}
      >
        <input className="input" placeholder="Survey plan number, e.g. LA/4410/2026" value={plan} onChange={(e) => setPlan(e.target.value)} required />
        <button className="btn btn--gold btn--sm" disabled={busy || !plan.trim()}>
          Approve plan
        </button>
      </form>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("Appoint registrar", (a) => a.setRegistrar(registrar, true))) setRegistrar("");
        }}
      >
        <input className="input mono" placeholder="Registrar wallet 0x…" list="accounts" value={registrar} onChange={(e) => setRegistrar(e.target.value)} required />
        <button className="btn btn--glass btn--sm" disabled={busy || !isAddress(registrar)}>
          Appoint
        </button>
      </form>
      <p className="meta">
        Registrars: {state.registrars.length ? state.registrars.map(short).join(", ") : "none yet"}
        {approved.some((p) => p.label) && (
          <>
            <br />
            Plans waiting to be registered: {approved.map((p) => p.label).filter(Boolean).join(", ")}
          </>
        )}
      </p>
      {state.registrars.length > 0 && (
        <div className="chips">
          {state.registrars.map((r) => (
            <button key={r} className="btn btn--danger btn--sm" disabled={busy} onClick={() => run("Remove registrar", (a) => a.setRegistrar(r, false))}>
              Remove {short(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RegistrarPanel({ state, busy, run }: { state: ChainState; busy: boolean; run: Run }) {
  const [f, setF] = useState({ owner: "", plan: "", doc: "", location: "", area: "" });
  const [docName, setDocName] = useState("");
  const [reason, setReason] = useState<Record<number, string>>({});
  const pending = state.parcels.filter((p) => p.pendingBuyer !== ZERO);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const ready = isAddress(f.owner) && f.plan.trim() && isHash(f.doc) && f.location.trim() && Number(f.area) > 0;

  return (
    <div className="panel">
      <h3>Registrar</h3>
      <p className="panel__say">Registers parcels on approved plans, approves sales, and flags disputes.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run("Register parcel", (a) => a.registerParcel(f.owner, f.plan, f.doc, f.location, Number(f.area)));
          if (ok) {
            setF({ owner: "", plan: "", doc: "", location: "", area: "" });
            setDocName("");
          }
        }}
      >
        <input className="input mono" placeholder="Owner wallet 0x…" list="accounts" value={f.owner} onChange={set("owner")} />
        <div className="row">
          <input className="input" placeholder="Survey plan number" value={f.plan} onChange={set("plan")} />
          <input className="input input--num" placeholder="Area m²" inputMode="numeric" value={f.area} onChange={set("area")} />
        </div>
        <input className="input" placeholder="Location, e.g. Plot 4, Block B, Epe, Lagos" value={f.location} onChange={set("location")} />
        <label className="drop drop--sm">
          <input
            type="file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setDocName(file.name);
              setF({ ...f, doc: await fileHash(file) });
            }}
          />
          <span>{docName ? `Deed hashed: ${docName}` : "Choose the title deed. Only its hash goes on-chain."}</span>
        </label>
        <button className="btn btn--gold btn--sm" disabled={busy || !ready}>
          Register parcel
        </button>
      </form>

      <h4>Sales waiting for approval</h4>
      {pending.length === 0 && <p className="empty">None right now.</p>}
      {pending.map((p) => (
        <div key={p.id} className="item">
          <span>
            #{p.id} {short(p.owner)} → {short(p.pendingBuyer)}
            {p.disputed && <b className="badge badge--disputed">Under dispute</b>}
          </span>
          <button className="btn btn--gold btn--sm" disabled={busy} onClick={() => run("Approve sale", (a) => a.approveTransfer(p.id))}>
            Approve
          </button>
        </div>
      ))}

      <h4>Disputes</h4>
      {state.parcels.map((p) => (
        <div key={p.id} className="item">
          <span className="ellip">
            #{p.id} {p.location}
          </span>
          <span className="row row--tight">
            <input
              className="input input--sm"
              placeholder={p.disputed ? "Resolution" : "Reason"}
              value={reason[p.id] ?? ""}
              onChange={(e) => setReason({ ...reason, [p.id]: e.target.value })}
              aria-label={`${p.disputed ? "Resolution" : "Reason"} for parcel ${p.id}`}
            />
            {p.disputed ? (
              <button className="btn btn--glass btn--sm" disabled={busy} onClick={() => run("Clear dispute", (a) => a.clearDispute(p.id, reason[p.id] ?? ""))}>
                Clear
              </button>
            ) : (
              <button className="btn btn--danger btn--sm" disabled={busy || !reason[p.id]?.trim()} onClick={() => run("Flag dispute", (a) => a.flagDispute(p.id, reason[p.id] ?? ""))}>
                Flag
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function OwnerPanel({ me, mine, busy, run, connected }: { me: string; mine: Parcel[]; busy: boolean; run: Run; connected: boolean }) {
  const [to, setTo] = useState<Record<number, string>>({});
  return (
    <div className="panel">
      <h3>My land</h3>
      <p className="panel__say">Offer a parcel to a buyer. A registrar must approve before ownership moves.</p>
      {!connected && <p className="empty">Connect a wallet to see parcels registered to you.</p>}
      {connected && mine.length === 0 && <p className="empty">No parcels are registered to {short(me)}.</p>}
      {mine.map((p) => (
        <div key={p.id} className="own">
          <p>
            <strong>#{p.id}</strong> {p.location} <span className="meta">· {fmtArea(p.areaSqm)}</span>
          </p>
          {p.disputed ? (
            <p className="meta">Frozen by a dispute. Sales open again once a registrar clears it.</p>
          ) : p.pendingBuyer !== ZERO ? (
            <div className="item">
              <span>Offered to {short(p.pendingBuyer)}, waiting for a registrar.</span>
              <button className="btn btn--glass btn--sm" disabled={busy} onClick={() => run("Withdraw sale", (a) => a.cancelTransfer(p.id))}>
                Withdraw
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                className="input mono"
                placeholder="Buyer wallet 0x…" list="accounts"
                value={to[p.id] ?? ""}
                onChange={(e) => setTo({ ...to, [p.id]: e.target.value })}
                aria-label={`Buyer for parcel ${p.id}`}
              />
              <button
                className="btn btn--gold btn--sm"
                disabled={busy || !isAddress(to[p.id] ?? "")}
                onClick={async () => {
                  if (await run("Offer for sale", (a) => a.proposeTransfer(p.id, to[p.id]))) setTo({ ...to, [p.id]: "" });
                }}
              >
                Offer
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
