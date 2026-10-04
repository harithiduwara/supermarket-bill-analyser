/** Hand/OCR-transcribed paper receipt -> canonical Bill.
 * Port of keells-bill-analysis/scripts/transcribe_receipt.py.
 *
 * Nothing here trusts the transcription: every line is recomputed and the
 * printed totals are kept separately so reconcile() can compare them.
 * Difference from the Python: a missing printed total is an error here, not a
 * vacuous pass (the Python defaulted it to the computed value).
 */
import { round, sum } from "./num";
import type { Bill, BillItem, Promotion, Tender } from "./types";

export interface ReceiptLineInput {
  ln?: number | null;
  code: string;
  name: string;
  rate: number;
  qty: number;
  /** positive, however the receipt prints it */
  discount: number;
  /** post-discount figure as printed on the receipt */
  amount: number;
  scheme?: string | null;
}

export interface ReceiptInput {
  ref: string;
  source: string;
  store: string;
  storeCode: string;
  date: string;
  time: string;
  pointsEarned: number | null;
  pointsBalancePrinted: number | null;
  loyaltyScheme?: string | null;
  printed: { gross: number; discount: number; net: number };
  tenders: Tender[];
  lines: ReceiptLineInput[];
  transcribedFrom?: string;
  notes?: string;
}

export function buildReceipt(src: ReceiptInput): Bill {
  const items: BillItem[] = src.lines.map((ln, idx) => {
    const disc = Math.abs(ln.discount || 0);
    return {
      line: ln.ln ?? idx + 1,
      code: ln.code,
      name: ln.name,
      unitPrice: ln.rate,
      qty: ln.qty,
      amount: round(ln.rate * ln.qty), // gross, to match e-bill lines
      netAmount: ln.amount,
      lineDiscount: disc,
    };
  });

  // group line discounts into promotion records by scheme
  const byScheme = new Map<string, BillItem[]>();
  src.lines.forEach((ln, idx) => {
    const it = items[idx];
    if (!(it.lineDiscount! > 0)) return;
    const scheme = ln.scheme || "(unlabelled)";
    byScheme.set(scheme, [...(byScheme.get(scheme) ?? []), it]);
  });
  const promotions: Promotion[] = [...byScheme.entries()].map(([scheme, its]) => ({
    scheme,
    line: null,
    code: null,
    pct: round((sum(its.map((i) => i.lineDiscount!)) / sum(its.map((i) => i.amount))) * 100, 1),
    amount: round(sum(its.map((i) => i.lineDiscount!))),
  }));

  return {
    ref: src.ref,
    source: src.source,
    store: src.store,
    storeCode: src.storeCode,
    date: src.date,
    time: src.time,
    gross: src.printed.gross,
    discount: src.printed.discount,
    net: src.printed.net,
    pointsEarned: src.pointsEarned,
    pointsBalancePrinted: src.pointsBalancePrinted,
    loyaltyScheme: src.loyaltyScheme ?? null,
    tenders: src.tenders,
    promotions,
    items,
    transcribedFrom: src.transcribedFrom ?? "photograph",
    notes: src.notes,
  };
}
