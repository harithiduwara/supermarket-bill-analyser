/** The single ingest path every input goes through (design rules 2 and 3):
 * e-bill, photo receipt, backup import, seed. */
import { allPass, failures, reconcile } from "./reconcile";
import { canonical } from "./workbook";
import type { LedgerStore } from "./store";
import type { Bill, IngestResult, InputPath } from "./types";

export interface IngestOptions {
  images?: Blob[];
  via?: InputPath;
  /** skip the per-bill audit event (callers log one summary instead) */
  silent?: boolean;
}

/** Idempotent on `ref`: a bill already in the ledger is a no-op, whatever it
 * contains. A bill that fails any applicable check is NOT saved. */
export async function ingest(
  store: LedgerStore,
  bill: Bill,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const checks = reconcile(bill);
  const record = async (status: IngestResult["status"], detail?: string) => {
    if (!opts.silent) await store.log({ type: status, ref: bill.ref, via: opts.via, detail });
    return { status, ref: bill.ref, checks } satisfies IngestResult;
  };
  if (await store.has(bill.ref)) return record("duplicate", "already in the ledger; nothing changed");
  if (!allPass(checks)) {
    return record(
      "rejected",
      `failed: ${failures(checks)
        .map((c) => c.label)
        .join("; ")}`,
    );
  }
  await store.add(bill, opts.images);
  return record("added");
}

export async function ingestMany(
  store: LedgerStore,
  bills: Bill[],
  opts: IngestOptions = {},
): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  for (const b of bills) out.push(await ingest(store, b, opts));
  return out;
}

const EBILL_REF = /^[A-Z0-9]{6}$/;

/** `https://digibill.keellssuper.com/AB12CD` (or just `AB12CD`) -> `AB12CD`. */
export function refFromEbillUrl(input: string): string | null {
  const t = input
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const last = t.split("/").pop()?.toUpperCase() ?? "";
  return EBILL_REF.test(last) ? last : null;
}

/** Receipt reference, prefixed by store so it is one the store would recognise. */
export const receiptRef = (prefix: string, ticket: string): string =>
  `${prefix.trim().toUpperCase()}${ticket.trim()}`;

/** Backup format. Import validates the file, then runs every bill through ingest(), so it is
 * idempotent and a corrupt or hostile file cannot smuggle in a bill that fails a check. */
export interface LedgerFile {
  version: 1;
  exportedAt: string;
  bills: Bill[];
}

export async function exportLedger(store: LedgerStore, now: Date = new Date()): Promise<LedgerFile> {
  // demo bills are fake: they never leave the app in a backup
  const bills = (await store.all())
    .filter((b) => !b.demo)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  await store.log({ type: "export", detail: `${bills.length} bills`, via: undefined }, now);
  return { version: 1, exportedAt: now.toISOString(), bills };
}

export interface ImportSummary {
  added: number;
  duplicate: number;
  /** already in the ledger, but the file's copy differs: the ledger copy was kept (never overwritten) */
  conflicts: string[];
  /** passed validation but failed reconciliation */
  rejected: { ref: string; failing: string[] }[];
  /** failed validation (shape/size) or could not be read */
  invalid: { index: number; ref: string | null; reason: string }[];
}

/** The one merge path for backup files and workbooks. Bills are validated, then pushed through ingest(), so the
 * reconciliation gate and idempotency apply exactly as for a bill typed in by hand. */
export async function importBills(
  store: LedgerStore,
  raw: unknown[],
  priorInvalid: ImportSummary["invalid"] = [],
): Promise<ImportSummary> {
  // Loaded on demand: the validator (zod) is only needed when a file is imported, and keeps it out of the main bundle.
  const { validateBills } = await import("./validate");
  const { bills, invalid } = validateBills(raw);
  const summary: ImportSummary = {
    added: 0,
    duplicate: 0,
    conflicts: [],
    rejected: [],
    invalid: [...priorInvalid, ...invalid],
  };
  for (const b of bills) {
    const r = await ingest(store, b, { via: "import", silent: true });
    if (r.status === "added") summary.added++;
    else if (r.status === "duplicate") {
      summary.duplicate++;
      const have = await store.get(b.ref);
      if (have && canonical(have) !== canonical(b)) summary.conflicts.push(b.ref);
    } else summary.rejected.push({ ref: r.ref, failing: failures(r.checks).map((c) => c.label) });
  }
  return summary;
}

export const describeImport = (s: ImportSummary): string =>
  `${s.added} added, ${s.duplicate} already present${s.conflicts.length ? ` (${s.conflicts.length} differ from the ledger copy, ledger kept)` : ""}, ${s.rejected.length} failed checks, ${s.invalid.length} invalid`;

/** JSON backup. Throws (with a user-readable reason) if the file as a whole is unusable; changes nothing then. */
export async function importLedger(store: LedgerStore, raw: string): Promise<ImportSummary> {
  const { parseLedgerFile } = await import("./validate");
  const { bills, invalid } = parseLedgerFile(raw);
  const summary = await importBills(store, bills, invalid);
  await store.log({ type: "import", via: "import", detail: describeImport(summary) });
  return summary;
}
