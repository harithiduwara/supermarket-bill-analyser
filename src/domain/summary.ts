/** Plain aggregates for the workbook's readable sheets. Pure and derived on read (ADR-0003); every figure is a sum
 * of figures printed on the bills — nothing inferred. (Categories and scheme models arrive with Phase 2/3.) */
import { round, sum } from "./num";
import type { Bill } from "./types";

export interface Headline {
  bills: number;
  lines: number;
  gross: number;
  discount: number;
  net: number;
  discountRate: number;
  averageBasket: number;
  medianBasket: number;
  first: string | null;
  last: string | null;
  days: number;
  keellsBills: number;
  keellsNet: number;
}

const dayNumber = (ymd: string): number =>
  Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000;

export function headline(bills: Bill[]): Headline {
  const gross = round(sum(bills.map((b) => b.gross)));
  const discount = round(sum(bills.map((b) => b.discount)));
  const net = round(sum(bills.map((b) => b.net)));
  const dates = bills.map((b) => b.date).sort();
  const nets = bills.map((b) => b.net).sort((a, b) => a - b);
  const mid = nets.length >> 1;
  const keells = bills.filter((b) => b.source === "keells");
  return {
    bills: bills.length,
    lines: sum(bills.map((b) => b.items.length)),
    gross,
    discount,
    net,
    discountRate: gross ? discount / gross : 0,
    averageBasket: bills.length ? round(net / bills.length) : 0,
    medianBasket: nets.length ? round(nets.length % 2 ? nets[mid] : (nets[mid - 1] + nets[mid]) / 2) : 0,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    days: dates.length ? dayNumber(dates[dates.length - 1]) - dayNumber(dates[0]) + 1 : 0,
    keellsBills: keells.length,
    keellsNet: round(sum(keells.map((b) => b.net))),
  };
}

export interface MonthRow {
  month: string;
  bills: number;
  gross: number;
  discount: number;
  net: number;
  discountRate: number;
  averageBasket: number;
  keellsNet: number;
}

export function monthlyTrend(bills: Bill[]): MonthRow[] {
  const months = [...new Set(bills.map((b) => b.date.slice(0, 7)))].sort();
  return months.map((month) => {
    const bs = bills.filter((b) => b.date.startsWith(month));
    const gross = round(sum(bs.map((b) => b.gross)));
    const discount = round(sum(bs.map((b) => b.discount)));
    const net = round(sum(bs.map((b) => b.net)));
    return {
      month,
      bills: bs.length,
      gross,
      discount,
      net,
      discountRate: gross ? discount / gross : 0,
      averageBasket: round(net / bs.length),
      keellsNet: round(sum(bs.filter((b) => b.source === "keells").map((b) => b.net))),
    };
  });
}

export interface Share {
  key: string;
  bills: number;
  amount: number;
  share: number;
}

const shares = (pairs: { key: string; bill: string; amount: number }[]): Share[] => {
  const total = sum(pairs.map((p) => p.amount));
  const m = new Map<string, { bills: Set<string>; amount: number }>();
  for (const p of pairs) {
    const e = m.get(p.key) ?? { bills: new Set<string>(), amount: 0 };
    e.bills.add(p.bill);
    e.amount += p.amount;
    m.set(p.key, e);
  }
  return [...m.entries()]
    .map(([key, e]) => ({
      key,
      bills: e.bills.size,
      amount: round(e.amount),
      share: total ? e.amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
};

export const byStore = (bills: Bill[]): Share[] =>
  shares(bills.map((b) => ({ key: b.store || "(unnamed)", bill: b.ref, amount: b.net })));

/** Payment instruments exactly as printed on the bills (e.g. "Seylan-RewadzPay-0000"). */
export const byPayment = (bills: Bill[]): Share[] =>
  shares(bills.flatMap((b) => b.tenders.map((t) => ({ key: t.method, bill: b.ref, amount: t.amount }))));
