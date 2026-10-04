import { describe, expect, it } from "vitest";
import type { Bill } from "../../src/domain/types";
import {
  billsToTables,
  canonical,
  COLUMNS,
  FORMULA,
  ledgerChecksum,
  RAW_TEXT_PART,
  tablesToBills,
  type DataTables,
} from "../../src/domain/workbook";
import { allSeed } from "./helpers";

const seed = allSeed();
const clone = <T>(x: T): T => structuredClone(x);
/** What a sheet read gives back: the same values, as untyped rows. */
const asRead = (t: DataTables<Record<string, unknown>>): DataTables => clone(t) as DataTables;
const roundTrip = (bills: Bill[]) => tablesToBills(asRead(billsToTables(bills)));

describe("US-24 / NFR-14 the data layer is lossless", () => {
  it("every one of the 24 seed bills survives tables → bills unchanged", () => {
    const { bills, problems } = roundTrip(seed);
    expect(problems).toEqual([]);
    const byRef = new Map((bills as Bill[]).map((b) => [b.ref, b]));
    for (const b of seed) expect(canonical(byRef.get(b.ref)!), b.ref).toBe(canonical(b));
    expect(bills).toHaveLength(24);
  });

  it("repeating the round trip changes nothing, however many times", () => {
    let current = seed;
    for (let i = 0; i < 5; i++) current = roundTrip(current).bills as Bill[];
    expect(current.map(canonical).sort()).toEqual(seed.map(canonical).sort());
  });

  it("keeps zero distinct from 'not printed' (null) for points", () => {
    const a = clone(seed[0]);
    a.pointsEarned = 0;
    a.pointsBalancePrinted = null;
    const [back] = roundTrip([a]).bills as Bill[];
    expect(back.pointsEarned).toBe(0);
    expect(back.pointsBalancePrinted).toBeNull();
  });

  it("keeps photo-receipt fields: line numbers, line discounts, net amounts, scheme, notes", () => {
    const g = seed.find((b) => b.ref === "GLO900003")!;
    const [back] = roundTrip([g]).bills as Bill[];
    expect(back.items.map((i) => [i.line, i.lineDiscount, i.netAmount])).toEqual(
      g.items.map((i) => [i.line, i.lineDiscount, i.netAmount]),
    );
    expect(back.promotions).toEqual(g.promotions);
    expect(back.loyaltyScheme).toBe(g.loyaltyScheme);
  });

  it("keeps original e-bill text of any length, split across cells under Excel's 32,767-character limit", () => {
    const big = clone(seed[0]);
    big.rawText = "line é ü — 日本語\n".repeat(5000); // ~75,000 chars
    const t = billsToTables([big]);
    expect(t.rawText.length).toBe(Math.ceil(big.rawText.length / RAW_TEXT_PART));
    expect(t.rawText.every((r) => String(r.text).length <= RAW_TEXT_PART)).toBe(true);
    const [back] = tablesToBills(asRead(t)).bills as Bill[];
    expect(back.rawText).toBe(big.rawText);
  });

  it("keeps text that looks like a formula as text", () => {
    const b = clone(seed[0]);
    b.items[0].name = '=HYPERLINK("http://evil.example","x")';
    b.store = "+cmd|' /C calc'!A0";
    const [back] = roundTrip([b]).bills as Bill[];
    expect(back.items[0].name).toBe(b.items[0].name);
    expect(back.store).toBe(b.store);
  });

  it("writes one header per column, in a fixed documented order", () => {
    const t = billsToTables(seed);
    for (const k of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
      for (const row of t[k]) expect(Object.keys(row)).toEqual([...COLUMNS[k]]);
    }
  });

  it("orders bills oldest first, so two exports of the same ledger are identical", () => {
    const a = billsToTables([...seed].reverse());
    const b = billsToTables(seed);
    expect(a).toEqual(b);
    const dates = b.bills.map((r) => String(r.date) + String(r.time));
    expect(dates).toEqual([...dates].sort());
  });
});

describe("NFR-13 reading is strict, inert and never guesses", () => {
  const fyq = seed.find((b) => b.ref === "DEM003")!; // has lines, 2 tenders, 2 promotions and raw text
  const base = () => asRead(billsToTables([clone(fyq)]));

  it("detects a truncated sheet instead of silently importing fewer lines", () => {
    const t = base();
    t.items.pop();
    const r = tablesToBills(t);
    expect(r.bills).toEqual([]);
    expect(r.problems[0]).toMatchObject({ ref: "DEM003" });
    expect(r.problems[0].reason).toMatch(/declares \d+ lines but contains \d+/);
  });
  it("detects missing tender / promotion / raw-text rows the same way", () => {
    for (const [k, word] of [
      ["tenders", "tenders"],
      ["promotions", "promotions"],
      ["rawText", "raw-text parts"],
    ] as const) {
      const t = base();
      t[k].pop();
      expect(tablesToBills(t).problems[0].reason, k).toMatch(new RegExp(`declares \\d+ ${word}`));
    }
  });
  it("refuses formulas anywhere in a data cell — they are never evaluated", () => {
    const t = base();
    t.bills[0].gross = FORMULA;
    expect(tablesToBills(t).problems[0].reason).toMatch(/gross contains a formula/);
    const u = base();
    u.items[2].name = FORMULA;
    expect(tablesToBills(u).problems[0].reason).toMatch(/line 3 name contains a formula/);
  });
  it("refuses non-numeric numbers and accepts numeric text (a cell Excel stored as text)", () => {
    const t = base();
    t.bills[0].net = "twelve";
    expect(tablesToBills(t).problems[0].reason).toMatch(/net is not a number/);
    const u = base();
    u.bills[0].net = String(fyq.net);
    expect(tablesToBills(u).problems).toEqual([]);
  });
  it("requires the essentials rather than defaulting them", () => {
    for (const col of ["ref", "source", "date", "gross", "net"]) {
      const t = base();
      t.bills[0][col] = null;
      const r = tablesToBills(t);
      expect(r.bills, col).toEqual([]); // never imported with a defaulted value
      expect(r.problems.length, col).toBeGreaterThanOrEqual(1);
    }
  });
  it("reports orphan child rows and duplicate refs without crashing", () => {
    const t = base();
    t.items.push({ ref: "GHOST1", seq: 1, code: "1", name: "x", unitPrice: 1, qty: 1, amount: 1 });
    t.bills.push(clone(t.bills[0]));
    const r = tablesToBills(t);
    expect(r.bills).toHaveLength(1);
    expect(r.problems.map((p) => p.reason).join("\n")).toMatch(/appears twice/);
    expect(r.problems.map((p) => p.reason).join("\n")).toMatch(
      /lines rows reference bills that are not in Data_Bills \(GHOST1\)/,
    );
  });
  it("accepts a code Excel converted to a number, as text", () => {
    const t = base();
    t.items[0].code = 110201;
    expect(tablesToBills(t).problems).toEqual([]);
    expect((tablesToBills(t).bills[0] as Bill).items[0].code).toBe("110201");
  });
  it("one bad bill does not stop the others", () => {
    const t = asRead(billsToTables(seed.slice(0, 3)));
    t.bills[1].gross = "x";
    const r = tablesToBills(t);
    expect(r.bills).toHaveLength(2);
    expect(r.problems).toHaveLength(1);
  });
});

describe("NFR-14 checksum", () => {
  it("is stable, order-independent, and survives the round trip", async () => {
    const a = await ledgerChecksum(seed);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ledgerChecksum([...seed].reverse())).toBe(a);
    expect(await ledgerChecksum(roundTrip(seed).bills as Bill[])).toBe(a);
  });
  it("changes when any figure changes", async () => {
    const a = await ledgerChecksum(seed);
    const edited = clone(seed);
    edited[3].items[0].amount += 0.01;
    expect(await ledgerChecksum(edited)).not.toBe(a);
    expect(await ledgerChecksum(seed.slice(1))).not.toBe(a);
  });
  it("treats null, undefined and empty optional fields as the same thing", () => {
    const a = clone(seed[0]);
    const b = clone(seed[0]);
    a.loyaltyScheme = null;
    b.loyaltyScheme = undefined;
    b.notes = "";
    expect(canonical(a)).toBe(canonical(b));
  });
});
