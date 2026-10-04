/** The 24 real bills, loaded through the SAME parser and reconciler as new bills.
 *
 * Keells bills are re-parsed from the saved e-bill text (raw/), Glomark ones
 * rebuilt from the hand-transcribed receipts. tests/seed.test.ts proves the
 * result equals the original Python ledger.json, so the port is checked against
 * the Python every run, not trusted.
 */
import { parseBill } from "./parse";
import { buildReceipt, type ReceiptInput } from "./receipt";
import type { Bill } from "./types";

const raws = import.meta.glob("../seed/raw/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const receipts = import.meta.glob("../seed/receipts/*.json", { eager: true, import: "default" }) as Record<string, any>;

export function seedBills(): Bill[] {
  const out: Bill[] = [];
  for (const [path, text] of Object.entries(raws)) {
    const ref = path.split("/").pop()!.replace(/\.md$/, "");
    out.push(parseBill(text, ref));
  }
  for (const r of Object.values(receipts)) {
    const input: ReceiptInput = {
      ref: r.ref, source: r.source, store: r.store, storeCode: r.store_code ?? "",
      date: r.date, time: r.time ?? "",
      pointsEarned: r.points_earned ?? null,
      pointsBalancePrinted: r.points_balance_printed ?? null,
      loyaltyScheme: r.loyalty_scheme ?? null,
      printed: r.printed, tenders: r.tenders,
      lines: r.lines.map((l: any, i: number) => ({
        ln: i + 1, code: l.code, name: l.name, rate: l.rate, qty: l.qty,
        discount: l.discount ?? 0, amount: l.amount, scheme: l.scheme ?? null,
      })),
      transcribedFrom: r.transcribed_from, notes: r.notes,
    };
    out.push(buildReceipt(input));
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
