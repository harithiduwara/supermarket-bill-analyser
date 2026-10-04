/** Export / import of the workbook against a ledger store — the loop the product is built around (ADR-0006):
 * add bills → export → next time import it plus new bills → export again. */
import { describeImport, importBills, type ImportSummary } from "../domain/ingest";
import type { LedgerStore } from "../domain/store";
import type { Bill } from "../domain/types";
import { ledgerChecksum, tablesToBills } from "../domain/workbook";
import { WorkbookError, type WorkbookMeta } from "./errors";
// the builder/reader (and ExcelJS behind it) load on demand: they are only needed to export or import
const xlsx = () => import("./xlsx");

const REFS_KEY = "workbook-refs";

/** Refs present in a workbook the user holds: those last exported, plus any imported from a file. */
async function savedRefs(store: LedgerStore): Promise<Set<string>> {
  try {
    const v: unknown = JSON.parse((await store.getMeta(REFS_KEY)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
const saveRefs = (store: LedgerStore, refs: Set<string>) =>
  store.setMeta(REFS_KEY, JSON.stringify([...refs]));

/** Bills in the ledger that are in no workbook the user holds — how out of date their file is. */
export async function billsNotInAnyWorkbook(store: LedgerStore): Promise<string[]> {
  const have = await savedRefs(store);
  return (await store.all()).map((b) => b.ref).filter((r) => !have.has(r));
}

export const workbookFilename = (at: Date): string => `grocery-ledger-${at.toISOString().slice(0, 10)}.xlsx`;

export interface ExportResult {
  data: ArrayBuffer;
  filename: string;
  bills: number;
}

export async function exportWorkbook(
  store: LedgerStore,
  opts: { appVersion: string; now?: Date },
): Promise<ExportResult> {
  const now = opts.now ?? new Date();
  const bills = await store.all();
  const data = await (await xlsx()).buildWorkbook(bills, { exportedAt: now, appVersion: opts.appVersion });
  await saveRefs(store, new Set(bills.map((b) => b.ref)));
  await store.log({ type: "export", detail: `workbook, ${bills.length} bills` }, now);
  return { data, filename: workbookFilename(now), bills: bills.length };
}

export type ChecksumStatus = "match" | "mismatch" | "absent";

export interface WorkbookImportSummary extends ImportSummary {
  meta: WorkbookMeta;
  /** bills actually read from the file (before validation and reconciliation) */
  billsInFile: number;
  checksum: ChecksumStatus;
  /** bills the ledger now holds that this file did not contain — the file is out of date for them */
  notInFile: number;
}

/** Throws WorkbookError (plain reason) if the file as a whole is unusable; the ledger is untouched then. */
export async function importWorkbook(
  store: LedgerStore,
  data: ArrayBuffer | Uint8Array,
): Promise<WorkbookImportSummary> {
  const { meta, tables } = await (await xlsx()).readWorkbook(data);
  const { bills, problems } = tablesToBills(tables);

  const summary = await importBills(
    store,
    bills,
    problems.map((p, index) => ({ index, ref: p.ref, reason: p.reason })),
  );

  let checksum: ChecksumStatus = "absent";
  if (meta.checksum) {
    const mine = problems.length ? null : await ledgerChecksum(bills as Bill[]);
    checksum =
      mine === null
        ? problems.length
          ? "mismatch"
          : "absent"
        : mine === meta.checksum
          ? "match"
          : "mismatch";
  }

  const inFile = new Set(bills.map((b) => (b as { ref: string }).ref));
  // bills the file contained are now safe in a workbook the user holds
  await saveRefs(store, new Set([...(await savedRefs(store)), ...inFile]));
  const notInFile = (await store.all()).filter((b) => !inFile.has(b.ref)).length;

  const result: WorkbookImportSummary = { ...summary, meta, billsInFile: bills.length, checksum, notInFile };
  await store.log({
    type: "import",
    via: "import",
    detail: `workbook${meta.exportedAt ? ` exported ${meta.exportedAt.slice(0, 10)}` : ""}: ${describeImport(summary)}; checksum ${checksum}`,
  });
  return result;
}

export { WorkbookError };
