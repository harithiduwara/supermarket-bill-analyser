import { describe, expect, it } from "vitest";
import { allPass, failures, reconcile } from "../src/domain/reconcile";
import type { Bill } from "../src/domain/types";
import { allSeed } from "./helpers";

const seed = allSeed();
const keells = (): Bill => structuredClone(seed.find((b) => b.ref === "FYQQRQ")!);
const glomark = (): Bill => structuredClone(seed.find((b) => b.ref === "GLO549921")!);
const failed = (b: Bill) => failures(reconcile(b)).map((c) => c.id);

describe("every seed bill passes every applicable check", () => {
  for (const b of seed) {
    it(b.ref, () => {
      const checks = reconcile(b);
      expect(failures(checks), JSON.stringify(failures(checks))).toEqual([]);
      expect(allPass(checks)).toBe(true);
    });
  }
  it("points check applies to Keells only", () => {
    const g = reconcile(glomark()).find((c) => c.id === "pointsMatchRate")!;
    expect(g.applicable).toBe(false);
    expect(reconcile(keells()).find((c) => c.id === "pointsMatchRate")!.applicable).toBe(true);
  });
  it("line arithmetic runs on photo receipts, not e-bills", () => {
    expect(reconcile(glomark()).some((c) => c.id === "lineArithmetic")).toBe(true);
    expect(reconcile(keells()).some((c) => c.id === "lineArithmetic")).toBe(false);
  });
});

describe("a deliberately corrupted bill is caught, with the arithmetic shown", () => {
  it("a wrong line amount fails items-equal-gross", () => {
    const b = keells();
    b.items[0].amount += 10;
    expect(failed(b)).toEqual(["itemsEqualGross"]);
    const c = reconcile(b).find((x) => x.id === "itemsEqualGross")!;
    expect(c.detail).toMatch(/printed gross 4,367\.56/);
    expect(c.detail).toMatch(/diff \+10\.00/);
  });
  it("a wrong printed net fails gross−discount=net and tenders", () => {
    const b = keells();
    b.net += 1;
    expect(failed(b).sort()).toEqual(["grossLessDiscountEqualsNet", "tendersEqualNet"]);
  });
  it("points tolerance is 0.02 POINTS (≈ Rs 5.9 of net), as in the Python — a Rs 1 net error does not trip it", () => {
    const b = keells();
    b.net += 1;
    expect(reconcile(b).find((c) => c.id === "pointsMatchRate")!.ok).toBe(true);
    b.net += 10;
    expect(reconcile(b).find((c) => c.id === "pointsMatchRate")!.ok).toBe(false);
  });
  it("a wrong tender fails only the tender check", () => {
    const b = keells();
    b.tenders[0].amount -= 5;
    expect(failed(b)).toEqual(["tendersEqualNet"]);
  });
  it("a wrong promotion line fails only the promotion check", () => {
    const b = keells();
    b.promotions[0].amount += 3;
    expect(failed(b)).toEqual(["promoLinesEqualDiscount"]);
  });
  it("wrong points fail the points check", () => {
    const b = keells();
    b.pointsEarned! += 1;
    expect(failed(b)).toEqual(["pointsMatchRate"]);
  });
  it("missing points line is a failure, not an assumed 0", () => {
    const b = keells();
    b.pointsEarned = null;
    const c = reconcile(b).find((x) => x.id === "pointsMatchRate")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/not assuming 0/);
  });
  it("a misread digit on a photo receipt line fails line arithmetic", () => {
    const b = glomark();
    b.items[3].netAmount! += 10;
    expect(failed(b)).toContain("lineArithmetic");
    const d = reconcile(b).find((x) => x.id === "lineArithmetic")!.detail;
    expect(d).toMatch(/line 4 /);
  });
  it("tolerance is not widened: one cent passes, three cents fail", () => {
    const ok = keells();
    ok.gross += 0.01; ok.net += 0.01; ok.items[0].amount += 0.01;
    ok.tenders[0].amount += 0.01;
    expect(failed(ok)).not.toContain("itemsEqualGross");
    const bad = keells();
    bad.items[0].amount += 0.03;
    expect(failed(bad)).toContain("itemsEqualGross");
  });
});
