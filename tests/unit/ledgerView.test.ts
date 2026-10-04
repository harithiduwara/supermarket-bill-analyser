import { describe, expect, it } from "vitest";
import { defaultQuery, queryLedger } from "../../src/domain/ledgerView";
import type { Bill } from "../../src/domain/types";
import { allSeed } from "./helpers";

const seed = allSeed();
const q = (over: Partial<typeof defaultQuery> = {}) => ({ ...defaultQuery, limit: 1000, ...over });

describe("US-05 ledger view", () => {
  it("lists newest first by default and pages", () => {
    const v = queryLedger(seed, { ...defaultQuery, limit: 5 });
    expect(v.rows).toHaveLength(5);
    expect(v.matching).toBe(24);
    const dates = v.rows.map((r) => r.bill.date + r.bill.time);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
  it("filters by source, month and free text (ref, store, item)", () => {
    expect(queryLedger(seed, q({ source: "glomark" })).matching).toBe(3);
    expect(queryLedger(seed, q({ source: "keells" })).matching).toBe(21);
    expect(
      queryLedger(seed, q({ month: "2026-07" })).rows.every((r) => r.bill.date.startsWith("2026-07")),
    ).toBe(true);
    expect(queryLedger(seed, q({ text: "dem003" })).matching).toBe(1);
    expect(queryLedger(seed, q({ text: seed[0].store.toLowerCase() })).matching).toBeGreaterThan(1);
    expect(queryLedger(seed, q({ text: "chicken" })).matching).toBeGreaterThan(0);
    expect(queryLedger(seed, q({ text: "zzzz-no-such" })).matching).toBe(0);
  });
  it("sorts numerically and descending/ascending, with a stable tie-break", () => {
    const asc = queryLedger(seed, q({ sort: "net", dir: "asc" })).rows.map((r) => r.bill.net);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = queryLedger(seed, q({ sort: "lines", dir: "desc" })).rows.map((r) => r.bill.items.length);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    const a = queryLedger(seed, q({ sort: "store" })).rows.map((r) => r.bill.ref);
    const b = queryLedger([...seed].reverse(), q({ sort: "store" })).rows.map((r) => r.bill.ref);
    expect(a).toEqual(b);
  });
  it("totals are the sums of printed figures for what is in view, split Keells/all", () => {
    const v = queryLedger(seed, q());
    expect(v.totals.bills).toBe(24);
    expect(v.totals.net).toBeCloseTo(
      seed.reduce((s, b) => s + b.net, 0),
      2,
    );
    expect(v.totals.keellsBills).toBe(21);
    expect(v.totals.keellsNet).toBeCloseTo(
      seed.filter((b) => b.source === "keells").reduce((s, b) => s + b.net, 0),
      2,
    );
    expect(v.totals.gross - v.totals.discount).toBeCloseTo(v.totals.net, 2);
    expect(v.totals.failing).toBe(0);
  });
  it("flags a bill that no longer reconciles", () => {
    const bad: Bill = { ...structuredClone(seed[0]), net: seed[0].net + 99 };
    const v = queryLedger([bad, ...seed.slice(1)], q());
    expect(v.totals.failing).toBe(1);
    expect(v.rows.find((r) => !r.ok)?.bill.ref).toBe(bad.ref);
  });
  it("offers month and source options from the data", () => {
    const v = queryLedger(seed, q());
    expect(v.months).toEqual([...v.months].sort().reverse());
    expect(v.sources).toEqual(["glomark", "keells"]);
  });
  it("handles an empty ledger", () => {
    const v = queryLedger([], q());
    expect(v.matching).toBe(0);
    expect(v.totals.discountRate).toBe(0);
  });
});

describe("NFR-08 performance", () => {
  it("queries a 5,000-bill ledger in well under a second", () => {
    const big: Bill[] = [];
    for (let i = 0; i < 5000; i++)
      big.push({ ...structuredClone(seed[i % 24]), ref: `P${String(i).padStart(5, "0")}` });
    const t0 = performance.now();
    const v = queryLedger(big, { ...defaultQuery, text: "milk", limit: 50 });
    const ms = performance.now() - t0;
    expect(v.rows.length).toBe(50);
    console.log(`queryLedger(5000 bills): ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(1000); // NFR-08 budget; typically ~40 ms, the headroom absorbs slow CI runners
  });
});
