/** The single ingest path both inputs go through (design rules 2 and 3). */
import { allPass, reconcile } from "./reconcile";
import type { LedgerStore } from "./store";
import type { Bill, IngestResult } from "./types";

/** Idempotent on `ref`: a bill already in the ledger is a no-op, whatever it
 * contains. A bill that fails any applicable check is NOT saved. */
export async function ingest(store: LedgerStore, bill: Bill, images: Blob[] = []): Promise<IngestResult> {
  const checks = reconcile(bill);
  if (await store.has(bill.ref)) return { status: "duplicate", ref: bill.ref, checks };
  if (!allPass(checks)) return { status: "rejected", ref: bill.ref, checks };
  await store.add(bill, images);
  return { status: "added", ref: bill.ref, checks };
}

export async function ingestMany(store: LedgerStore, bills: Bill[]): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  for (const b of bills) out.push(await ingest(store, b));
  return out;
}

const EBILL_REF = /^[A-Z0-9]{6}$/;

/** `https://digibill.keellssuper.com/FYQQRQ` (or just `FYQQRQ`) -> `FYQQRQ`. */
export function refFromEbillUrl(input: string): string | null {
  const t = input.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const last = t.split("/").pop()?.toUpperCase() ?? "";
  return EBILL_REF.test(last) ? last : null;
}

/** Receipt reference, prefixed by store so it is one the store would recognise. */
export const receiptRef = (prefix: string, ticket: string): string =>
  `${prefix.trim().toUpperCase()}${ticket.trim()}`;

/** Backup format: `{ version, bills }`. Import goes through ingest(), so it is
 * idempotent and a corrupted file cannot smuggle in a bill that fails checks. */
export interface LedgerFile { version: 1; bills: Bill[] }
export const exportLedger = async (store: LedgerStore): Promise<LedgerFile> => ({
  version: 1,
  bills: (await store.all()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
});
