import { describe, expect, it } from "vitest";
import {
  buildKeellsBill,
  DEMO_REFS,
  demoBills,
  generateKeellsBill,
  renderEbill,
  rng,
} from "../../src/domain/demo";
import { parseBill } from "../../src/domain/parse";
import { allPass, reconcile } from "../../src/domain/reconcile";
import { POINTS_RATE } from "../../src/domain/rules";
import type { Bill } from "../../src/domain/types";
import { canonical } from "../../src/domain/workbook";

const sameWithoutRaw = (a: Bill, b: Bill) =>
  canonical({ ...a, rawText: undefined }) === canonical({ ...b, rawText: undefined });
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

describe("US-01 / NFR-02 synthetic e-bills round-trip through the real parser", () => {
  it("parse(render(bill)) returns the bill, and it reconciles — for 400 random seeds", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const bill = generateKeellsBill(seed);
      if (!allPass(reconcile(bill))) failures.push(`seed ${seed}: source bill does not reconcile`);
      const back = parseBill(renderEbill(bill, { seed }), bill.ref);
      if (!sameWithoutRaw(back, bill)) failures.push(`seed ${seed}: parsed bill differs from its source`);
      if (!allPass(reconcile(back))) failures.push(`seed ${seed}: parsed bill does not reconcile`);
    }
    expect(failures).toEqual([]);
  });

  it("covers both summary layouts, with and without discounts", () => {
    let table = 0;
    let bullets = 0;
    let discounted = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const b = generateKeellsBill(seed);
      const t = b.rawText as string;
      if (/^\| Net Amount\s*\|/m.test(t)) table++;
      if (/^- Net Amount/m.test(t)) bullets++;
      if (b.discount > 0) discounted++;
    }
    expect(table).toBeGreaterThan(50);
    expect(bullets).toBeGreaterThan(50);
    expect(discounted).toBeGreaterThan(50);
  });

  it("the wide-table layout also parses for a bill that has a discount-free basket in either layout", () => {
    const b = buildKeellsBill(rng(5), { ref: "LAYOUT", date: "2026-06-02", deals: 0, lines: 6 });
    for (const layout of ["bullets", "table"] as const) {
      const back = parseBill(renderEbill(b, { layout, seed: 1 }), b.ref);
      expect(sameWithoutRaw(back, b), layout).toBe(true);
    }
  });

  it("is deterministic: the same seed gives the same bill, different seeds differ", () => {
    expect(generateKeellsBill(7)).toEqual(generateKeellsBill(7));
    expect(canonical(generateKeellsBill(7))).not.toBe(canonical(generateKeellsBill(8)));
  });

  it("recognises a RewardzPay split (the bill's own misspelling) and keeps tenders summing to net", () => {
    const b = buildKeellsBill(rng(9), { ref: "SPLIT1", date: "2026-06-02", split: true, lines: 8 });
    expect(b.tenders).toHaveLength(2);
    expect(b.tenders[0].method).toMatch(/RewadzPay/);
    expect(parseBill(renderEbill(b), b.ref).tenders).toEqual(b.tenders);
  });

  it("rounds line deals UP to the whole rupee", () => {
    let seen = 0;
    for (let seed = 1; seed <= 400 && seen < 20; seed++) {
      for (const p of generateKeellsBill(seed).promotions.filter((x) => x.code)) {
        const line = generateKeellsBill(seed).items.find((i) => i.line === p.line)!;
        const exact = (line.amount * (p.pct as number)) / 100;
        expect(p.amount).toBe(Math.ceil(exact - 1e-9));
        expect(Number.isInteger(p.amount)).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe("the demo ledger (what a visitor loads)", () => {
  const demo = demoBills();
  const by = (ref: string) => demo.find((b) => b.ref === ref)!;

  it("is deterministic and has the shape the app and tests rely on: 21 Keells + 3 Glomark", () => {
    expect(demoBills()).toEqual(demo);
    expect(demo).toHaveLength(24);
    expect(demo.filter((b) => b.source === "keells")).toHaveLength(21);
    expect(demo.filter((b) => b.source === "glomark")).toHaveLength(3);
    expect(new Set(demo.map((b) => b.ref)).size).toBe(24);
  });

  it("every bill reconciles and every Keells bill's text parses back to it", () => {
    for (const b of demo) expect(allPass(reconcile(b)), b.ref).toBe(true);
    for (const b of demo.filter((x) => x.source === "keells")) {
      expect(sameWithoutRaw(parseBill(b.rawText as string, b.ref), b), b.ref).toBe(true);
    }
  });

  it("is ordered by date and sits in a window that is not anyone's real history", () => {
    const dates = demo.map((b) => b.date + b.time);
    expect(dates).toEqual([...dates].sort());
    expect(demo[0].date >= "2026-06-01" && demo[demo.length - 1].date <= "2026-08-31").toBe(true);
  });

  it("has the NTB fresh promotion on Sundays only: once below the cap, once at the Rs 1,500 cap", () => {
    const ntb = demo.filter((b) => b.promotions.some((p) => p.scheme?.includes("off on Fresh")));
    expect(ntb.length).toBeGreaterThanOrEqual(3);
    for (const b of ntb) expect(weekday(b.date), b.ref).toBe(0);
    const amount = (ref: string) =>
      by(ref).promotions.find((p) => p.scheme?.includes("off on Fresh"))!.amount;
    expect(amount(DEMO_REFS.ntb)).toBeLessThan(1500);
    expect(amount(DEMO_REFS.ntbCapped)).toBe(1500);
  });

  it("the NTB base is computed after line deals, on fruit/veg/poultry only (fish is excluded)", () => {
    const b = by(DEMO_REFS.ntbCapped);
    expect(b.items.some((i) => i.code.startsWith("941"))).toBe(true); // fish is in the basket…
    const base = b.items
      .filter((i) => ["912", "913", "914", "915", "916", "923", "935"].includes(i.code.slice(0, 3)))
      .reduce((s, i) => s + i.amount, 0);
    expect(base * 0.25).toBeGreaterThan(1500); // …the uncapped 25% is above the cap, so the cap bites
  });

  it("has a plain bill (wide-table layout) and a rich one (bullets, two tenders, deals)", () => {
    expect(by(DEMO_REFS.plain).rawText).toMatch(/^\| Net Amount\s*\|/m);
    expect(by(DEMO_REFS.plain).discount).toBe(0);
    const rich = by(DEMO_REFS.rich);
    expect(rich.rawText).toMatch(/^- Net Amount/m);
    expect(rich.tenders).toHaveLength(2);
    expect(rich.promotions.filter((p) => p.code).length).toBeGreaterThanOrEqual(1);
  });

  it("the points chain breaks exactly where intended — two missing trips and one bonus credit", () => {
    const keells = demo.filter((b) => b.source === "keells");
    const gaps: { at: string; points: number; impliedSpend: number }[] = [];
    keells.forEach((cur, i) => {
      if (!i) return;
      const prev = keells[i - 1];
      const gap =
        Math.round(
          ((cur.pointsBalancePrinted as number) -
            (prev.pointsBalancePrinted as number) -
            (prev.pointsEarned as number)) *
            100,
        ) / 100;
      if (Math.abs(gap) > 0.05) gaps.push({ at: cur.ref, points: gap, impliedSpend: gap / POINTS_RATE });
    });
    expect(gaps).toHaveLength(3);
    expect(gaps.filter((g) => g.impliedSpend > 30000)).toHaveLength(1); // a credit, not a basket
    expect(gaps.filter((g) => g.impliedSpend <= 30000).map((g) => Math.round(g.impliedSpend))).toEqual([
      3500, 8200,
    ]);
  });

  it("Glomark receipts: three schemes with their own exclusions; only Sampath is capped, on ONE truncated line", () => {
    const power = by(DEMO_REFS.glomarkPower);
    const seylan = by(DEMO_REFS.glomarkSeylan);
    const sampath = by(DEMO_REFS.glomarkSampath);
    expect(power.discount).toBeGreaterThan(0);
    expect(seylan.discount).toBeGreaterThan(0);
    expect(sampath.discount).toBe(2500);

    const excluded = (b: Bill, test: RegExp) =>
      b.items.filter((i) => test.test(i.name)).every((i) => !i.lineDiscount);
    expect(excluded(power, /UHT|MILK POWDER|EGG|CARRIER BAG/)).toBe(true);
    expect(excluded(sampath, /UHT|EGG|COCONUT|CHICKEN/)).toBe(true);
    expect(seylan.items.find((i) => /MILK POWDER/.test(i.name))!.lineDiscount).toBeGreaterThan(0); // Seylan excludes bags only

    const full = (b: Bill) =>
      b.items.filter(
        (i) =>
          (i.lineDiscount ?? 0) > 0 &&
          Math.abs((i.lineDiscount as number) - Math.round(i.amount * 25) / 100) < 0.011,
      );
    const discounted = sampath.items.filter((i) => (i.lineDiscount ?? 0) > 0);
    expect(discounted.length - full(sampath).length).toBe(1); // exactly one line is below the full 25%
    expect(power.promotions.some((p) => p.scheme === "MULTIPLE PROMOTION")).toBe(true); // a line with its own 40%
  });

  it("Glomark receipts keep their printed points unrelated to any flat rate", () => {
    const rates = demo.filter((b) => b.source === "glomark").map((b) => (b.pointsEarned as number) / b.net);
    expect(rates.every((r) => r > 0.003 && r < 0.005)).toBe(true);
    expect(rates.some((r) => Math.abs(r - POINTS_RATE) < 1e-6)).toBe(false);
  });
});
