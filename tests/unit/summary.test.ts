import { describe, expect, it } from "vitest";
import { byPayment, byStore, headline, monthlyTrend } from "../../src/domain/summary";
import { allSeed } from "./helpers";

const seed = allSeed();
const cents = (x: number) => Math.round(x * 100);
/** Independent of summary.ts: plain loops over the printed fields. */
const total = (bills: typeof seed, f: (b: (typeof seed)[number]) => number) =>
  bills.reduce((s, b) => s + f(b), 0);
const dayCount = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

describe("US-22 workbook figures are sums of printed figures", () => {
  it("headline totals equal an independent sum to the cent", () => {
    const h = headline(seed);
    expect(h.bills).toBe(24);
    expect(cents(h.gross)).toBe(cents(total(seed, (b) => b.gross)));
    expect(cents(h.discount)).toBe(cents(total(seed, (b) => b.discount)));
    expect(cents(h.net)).toBe(cents(total(seed, (b) => b.net)));
    expect(cents(h.gross - h.discount)).toBe(cents(h.net));
    expect(h.lines).toBe(total(seed, (b) => b.items.length));
    const dates = seed.map((b) => b.date).sort();
    expect(h.first).toBe(dates[0]);
    expect(h.last).toBe(dates[dates.length - 1]);
    expect(h.days).toBe(dayCount(dates[0], dates[dates.length - 1]));
    expect(h.keellsBills).toBe(21);
    expect(cents(h.keellsNet)).toBe(
      cents(
        total(
          seed.filter((b) => b.source === "keells"),
          (b) => b.net,
        ),
      ),
    );
  });
  it("monthly trend matches an independent grouping and sums back to the headline", () => {
    const m = monthlyTrend(seed);
    expect(m.map((x) => x.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    for (const x of m) {
      const mine = seed.filter((b) => b.date.startsWith(x.month));
      expect(x.bills).toBe(mine.length);
      expect(cents(x.net)).toBe(cents(total(mine, (b) => b.net)));
      expect(cents(x.gross)).toBe(cents(total(mine, (b) => b.gross)));
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
    expect(headline(seed.slice(0, 4)).medianBasket).toBeCloseTo((four[1] + four[2]) / 2, 1); // to the nearest cent
  });
});
