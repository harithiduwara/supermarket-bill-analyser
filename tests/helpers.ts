import fs from "node:fs";
import path from "node:path";
import { parseBill } from "../src/domain/parse";
import { buildReceipt, type ReceiptInput } from "../src/domain/receipt";
import type { Bill } from "../src/domain/types";

const root = path.resolve(__dirname, "..");
export const ledger: { bills: Record<string, any> } = JSON.parse(
  fs.readFileSync(path.join(root, "tests/fixtures/ledger.json"), "utf8"),
);

export const rawText = (ref: string) =>
  fs.readFileSync(path.join(root, "src/seed/raw", `${ref}.md`), "utf8");
export const rawRefs = () =>
  fs.readdirSync(path.join(root, "src/seed/raw")).map((f) => f.replace(/\.md$/, ""));
export const receiptJson = (ref: string) =>
  JSON.parse(fs.readFileSync(path.join(root, "src/seed/receipts", `${ref}.json`), "utf8"));
export const receiptRefs = () =>
  fs.readdirSync(path.join(root, "src/seed/receipts")).map((f) => f.replace(/\.json$/, ""));

export function receiptInput(r: any): ReceiptInput {
  return {
    ref: r.ref, source: r.source, store: r.store, storeCode: r.store_code ?? "",
    date: r.date, time: r.time ?? "",
    pointsEarned: r.points_earned ?? null, pointsBalancePrinted: r.points_balance_printed ?? null,
    loyaltyScheme: r.loyalty_scheme ?? null, printed: r.printed, tenders: r.tenders,
    lines: r.lines.map((l: any, i: number) => ({
      ln: i + 1, code: l.code, name: l.name, rate: l.rate, qty: l.qty,
      discount: l.discount ?? 0, amount: l.amount, scheme: l.scheme ?? null,
    })),
  };
}

export const allSeed = (): Bill[] => [
  ...rawRefs().map((r) => parseBill(rawText(r), r)),
  ...receiptRefs().map((r) => buildReceipt(receiptInput(receiptJson(r)))),
];
