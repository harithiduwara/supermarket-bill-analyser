/** Runtime validation of UNTRUSTED input: backup files imported by the user.
 *
 * TypeScript types do not exist at runtime, and an imported file can be corrupt,
 * hand-edited or hostile. Every bill that gets past here is still re-reconciled
 * by ingest() — validation guards shape and size, reconcile guards arithmetic.
 * Unknown keys are stripped. Bounds exist so a crafted file cannot exhaust memory.
 */
import { z } from "zod";
import type { Bill } from "./types";

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_BILLS = 20_000;

const amount = z.number().min(-1_000_000_000).max(1_000_000_000);
const text = (max: number) => z.string().max(max);
const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const itemSchema = z.object({
  line: z.number().int().min(0).max(100_000).optional(),
  code: text(40).min(1),
  name: text(200).min(1),
  unitPrice: amount,
  qty: amount,
  amount,
  lineDiscount: amount.optional(),
  netAmount: amount.optional(),
});

const billSchema = z.object({
  ref: z.string().regex(/^[A-Za-z0-9_-]{3,40}$/, "reference must be 3–40 letters, digits, - or _"),
  source: text(30).min(1),
  store: text(100),
  storeCode: text(40),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, "not a real calendar date"),
  time: z.string().regex(/^(\d{2}:\d{2})?$/),
  gross: amount,
  discount: amount,
  net: amount,
  pointsEarned: amount.nullable(),
  pointsBalancePrinted: amount.nullable(),
  loyaltyScheme: text(100).nullable().optional(),
  tenders: z.array(z.object({ method: text(100).min(1), amount })).max(20),
  promotions: z
    .array(
      z.object({
        scheme: text(200).nullable(),
        line: z.number().int().nullable(),
        code: text(40).nullable(),
        pct: z.number().min(0).max(1000).nullable(),
        amount,
      }),
    )
    .max(2000),
  items: z.array(itemSchema).min(1).max(2000),
  rawText: text(200_000).optional(),
  transcribedFrom: text(200).optional(),
  notes: text(2000).optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  bills: z.array(z.unknown()).max(MAX_BILLS),
});

export interface ParsedLedgerFile {
  bills: Bill[];
  /** bills dropped for shape/size reasons, with the reason — never silently */
  invalid: { index: number; ref: string | null; reason: string }[];
}

/** Parse the text of a backup file. Throws with a user-readable reason if the
 * file as a whole is unusable; per-bill problems are returned in `invalid`. */
export function parseLedgerFile(raw: string): ParsedLedgerFile {
  if (raw.length > MAX_IMPORT_BYTES) throw new Error("file is larger than 20 MB — refusing to read it");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("not valid JSON");
  }
  const file = fileSchema.safeParse(json);
  if (!file.success) throw new Error("not a ledger export (expected { version: 1, bills: [...] })");

  return validateBills(file.data.bills);
}

/** Shape/size validation of bill objects from ANY untrusted source (JSON backup, workbook). */
export function validateBills(raw: unknown[]): ParsedLedgerFile {
  const bills: Bill[] = [];
  const invalid: ParsedLedgerFile["invalid"] = [];
  raw.forEach((b, index) => {
    const r = billSchema.safeParse(b);
    if (r.success) bills.push(r.data as Bill);
    else {
      const ref = typeof (b as { ref?: unknown })?.ref === "string" ? (b as { ref: string }).ref : null;
      const issue = r.error.issues[0];
      invalid.push({ index, ref, reason: `${issue.path.join(".") || "bill"}: ${issue.message}` });
    }
  });
  return { bills, invalid };
}
