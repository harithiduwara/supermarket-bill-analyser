/** The demo ledger a visitor can load to try the app. Every bill is synthetic (src/domain/demo.ts) and flagged
 * `demo`, so it can be removed in one action and is never included in an export. */
import { demoBills } from "./demo";
import { ingestMany } from "./ingest";
import type { LedgerStore } from "./store";
import type { Bill, IngestResult } from "./types";

export const demoLedger = (): Bill[] => demoBills().map((b) => ({ ...b, demo: true }));

/** Load the demo bills: one summary event, not 24. Safe to repeat (idempotent on ref). */
export async function loadDemo(store: LedgerStore): Promise<IngestResult[]> {
  const bills = demoLedger();
  const results = await ingestMany(store, bills, { via: "seed", silent: true });
  const added = results.filter((r) => r.status === "added").length;
  await store.log({ type: "seed", via: "seed", detail: `${added} of ${bills.length} demo bills loaded` });
  return results;
}

/** Remove every demo bill (and nothing else). Returns how many were removed. */
export async function removeDemo(store: LedgerStore): Promise<number> {
  const refs = (await store.all()).filter((b) => b.demo).map((b) => b.ref);
  if (!refs.length) return 0;
  await store.remove(refs);
  await store.log({ type: "removed", detail: `${refs.length} demo bills removed` });
  return refs.length;
}
