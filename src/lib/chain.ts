// Shared types for the two back ends the app can talk to: the in-browser demo chain
// and the real LandLedger contract on Ethereum Sepolia. Both expose the same shape.
import { keccak256, toUtf8Bytes } from "ethers";

export enum PlanStatus {
  None = 0,
  Approved = 1,
  Used = 2,
}

export type Parcel = {
  id: number;
  owner: string;
  surveyPlan: string; // bytes32 hash of the plan number
  documentHash: string; // bytes32 hash of the title documents
  location: string;
  areaSqm: number;
  registeredAt: number; // unix seconds
  pendingBuyer: string; // zero address when no transfer is waiting
  disputed: boolean;
  transfers: number;
};

export type ChainEvent = {
  key: string;
  block: number;
  name: string;
  parcelId: number | null;
  detail: string;
  txHash: string;
};

export type Plan = { hash: string; label?: string; status: PlanStatus };

export type ChainState = {
  bureau: string;
  registrars: string[];
  plans: Plan[];
  parcels: Parcel[];
  events: ChainEvent[];
};

export type Actions = {
  setRegistrar(registrar: string, active: boolean): Promise<string>;
  approveSurveyPlan(planNumber: string): Promise<string>;
  registerParcel(owner: string, planNumber: string, documentHash: string, location: string, areaSqm: number): Promise<string>;
  proposeTransfer(id: number, to: string): Promise<string>;
  cancelTransfer(id: number): Promise<string>;
  approveTransfer(id: number): Promise<string>;
  flagDispute(id: number, reason: string): Promise<string>;
  clearDispute(id: number, resolution: string): Promise<string>;
};

export const ZERO = "0x0000000000000000000000000000000000000000";
export const ZERO_HASH = "0x" + "0".repeat(64);

/** Contract errors, written for people rather than developers. */
export const errorText: Record<string, string> = {
  NotBureau: "Only the land bureau can do that.",
  NotRegistrar: "Only an appointed registrar can do that.",
  NotOwner: "Only the current owner of this parcel can do that.",
  ZeroAddress: "Enter a valid wallet address.",
  EmptyValue: "Fill in every field before sending.",
  PlanNotApproved: "That survey plan isn’t approved, or a parcel is already registered on it.",
  PlanAlreadyKnown: "That survey plan is already on the ledger.",
  UnknownParcel: "No parcel with that number is registered.",
  TransferPending: "This parcel already has a sale waiting for approval.",
  NoPendingTransfer: "There is no sale waiting on this parcel.",
  UnderDispute: "This parcel is under dispute, so it can’t change hands until the dispute is cleared.",
  NotDisputed: "This parcel isn’t under dispute.",
  SelfTransfer: "You can’t transfer land to yourself.",
};

export class ContractError extends Error {
  constructor(public code: string) {
    super(errorText[code] ?? code);
  }
}

/**
 * Survey plan numbers are written many ways ("la/1234/2024 ", "LA/1234/2024").
 * The ledger stores the hash of one normal form, so every spelling finds the same plan.
 */
export function normalizePlan(planNumber: string) {
  return planNumber.trim().replace(/\s+/g, "").toUpperCase();
}

export function planHash(planNumber: string) {
  return keccak256(toUtf8Bytes(normalizePlan(planNumber)));
}

/** Hash a document in the browser. The file itself never leaves the device. */
export async function fileHash(file: Blob) {
  return keccak256(new Uint8Array(await file.arrayBuffer()));
}

export function isAddress(a: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

export function isHash(h: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(h.trim());
}

export function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function short(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

/** What a buyer needs to know, in one word. */
export function titleStatus(p: Parcel): "clear" | "disputed" | "pending" {
  if (p.disputed) return "disputed";
  if (p.pendingBuyer !== ZERO) return "pending";
  return "clear";
}

/** Find a parcel by its number ("3", "#3") or by its survey plan number ("LA/1234/2024"). */
export function lookup(parcels: Parcel[], query: string): Parcel | null {
  const q = query.trim();
  if (!q) return null;
  const n = q.replace(/^#/, "");
  if (/^\d+$/.test(n)) return parcels.find((p) => p.id === Number(n)) ?? null;
  const hash = planHash(q);
  return parcels.find((p) => p.surveyPlan === hash) ?? null;
}
