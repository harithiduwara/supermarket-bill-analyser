import { describe, expect, it } from "vitest";
import { byPayment, byStore, headline, monthlyTrend } from "../../src/domain/summary";
import { allSeed, ledger } from "./helpers";

const seed = allSeed();
const py = Object.values(ledger.bills) as {
  date: string;
  gross: number;
  discount: number;
  net: number;
  store: string;
  source: string;
  tenders: { method: string; amount: number }[];
}[];
const cents = (x: number) => Math.round(x * 100);

describe("US-22 workbook figures are sums of printed figures (checked against the Python ledger)", () => {
  it("headline totals equal the Python ledger's totals to the cent", () => {
    const h = headline(seed);
    expect(h.bills).toBe(24);
    expect(cents(h.gross)).toBe(cents(py.reduce((s, b) => s + b.gross, 0)));
    expect(cents(h.discount)).toBe(cents(py.reduce((s, b) => s + b.discount, 0)));
    expect(cents(h.net)).toBe(cents(py.reduce((s, b) => s + b.net, 0)));
    expect(cents(h.gross - h.discount)).toBe(cents(h.net));
    expect(h.first).toBe("2026-07-30");
    expect(h.last).toBe("2026-10-03");
    expect(h.days).toBe(66);
    expect(h.keellsBills).toBe(21);
  });
  it("monthly trend sums back to the headline", () => {
    const m = monthlyTrend(seed);
    expect(m.map((x) => x.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    for (const x of m) {
      const mine = py.filter((b) => b.date.startsWith(x.month));
      expect(x.bills).toBe(mine.length);
      expect(cents(x.net)).toBe(cents(mine.reduce((s, b) => s + b.net, 0)));
    }
    expect(cents(m.reduce((s, x) => s + x.net, 0))).toBe(cents(headline(seed).net));
  });
  it("by-store and by-payment amounts each reconcile to net paid", () => {
    const net = headline(seed).net;
    expect(cents(byStore(seed).reduce((s, x) => s + x.amount, 0))).toBe(cents(net));
    expect(cents(byPayment(seed).reduce((s, x) => s + x.amount, 0))).toBe(cents(net));
    expect(byStore(seed).reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(byPayment(seed).some((p) => /RewadzPay/.test(p.key))).toBe(true); // the bills' own spelling is kept
  });
  it("is empty-safe", () => {
    const h = headline([]);
    expect(h).toMatchObject({ bills: 0, net: 0, discountRate: 0, first: null, days: 0 });
    expect(monthlyTrend([])).toEqual([]);
    expect(byStore([])).toEqual([]);
  });
  it("median handles even and odd counts", () => {
    const three = seed
      .slice(0, 3)
      .map((b) => b.net)
      .sort((a, b) => a - b);
    expect(headline(seed.slice(0, 3)).medianBasket).toBe(three[1]);
    const four = seed
      .slice(0, 4)
      .map((b) => b.net)
      .sort((a, b) => a - b);
    expect(headline(seed.slice(0, 4)).medianBasket).toBeCloseTo((four[1] + four[2]) / 2, 2);
  });
});
