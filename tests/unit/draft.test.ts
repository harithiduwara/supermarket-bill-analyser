import { describe, expect, it } from "vitest";
import { evaluate, fromOcr, lineStatus, blankDraft, type ReceiptDraft } from "../../src/domain/draft";
import { draftFromBill, ebillDate, rawText, seedBill } from "./helpers";

const draftFromReceipt = (ref: string): ReceiptDraft => draftFromBill(seedBill(ref));

describe("US-02 receipt draft (OCR confirmation table logic)", () => {
  it("a correctly transcribed receipt can be saved", () => {
    const o = evaluate(draftFromReceipt("GLO900003"));
    expect(o.problems).toEqual([]);
    expect(o.canSave).toBe(true);
  });
  it("one wrong digit disables saving and names the line", () => {
    const d = draftFromReceipt("GLO900003");
    d.lines[6].amount = String(Number(d.lines[6].amount) + 10);
    expect(lineStatus(d.lines[6]).ok).toBe(false);
    const o = evaluate(d);
    expect(o.canSave).toBe(false);
    expect(o.checks.some((c) => c.id === "lineArithmetic" && !c.ok && /line 7 /.test(c.detail))).toBe(true);
  });
  it("a wrong printed total disables saving", () => {
    const d = draftFromReceipt("GLO900003");
    d.printedNet = String(Number(d.printedNet) + 1);
    expect(evaluate(d).canSave).toBe(false);
  });
  it("blank figures are problems, not zeros", () => {
    const d = draftFromReceipt("GLO900003");
    d.lines[0].rate = "";
    d.printedDiscount = "";
    const o = evaluate(d);
    expect(o.canSave).toBe(false);
    expect(o.problems.join("\n")).toMatch(/Line 1/);
    expect(o.problems.join("\n")).toMatch(/Printed discount is blank/);
  });
  it("an empty draft cannot be saved", () => {
    expect(evaluate(blankDraft()).canSave).toBe(false);
  });
  it("OCR nulls become blanks the user must fill", () => {
    const d = fromOcr({
      store: null,
      storeCode: null,
      ticket: null,
      date: null,
      time: null,
      printedGross: null,
      printedDiscount: null,
      printedNet: null,
      pointsEarned: null,
      pointsBalance: null,
      loyaltyScheme: null,
      tenders: [],
      lines: [{ ln: 1, code: "1", name: "X", rate: null, qty: 1, discount: 0, amount: 5, scheme: null }],
    });
    expect(d.lines[0].rate).toBe("");
    expect(evaluate(d).canSave).toBe(false);
  });
});

import { parseNum } from "../../src/domain/draft";
import { parseBill } from "../../src/domain/parse";

describe("US-02 draft validation details", () => {
  it("parseNum accepts separators and rejects blanks and junk — never defaults", () => {
    expect(parseNum("1,234.50")).toBe(1234.5);
    expect(parseNum(" 7 ")).toBe(7);
    expect(parseNum("-3")).toBe(-3);
    for (const bad of ["", "  ", "abc", "1.2.3", "12abc", "NaN", "Infinity"])
      expect(parseNum(bad)).toBeNull();
  });
  it("rejects malformed dates/times and duplicate line numbers and missing tenders", () => {
    const d = draftFromReceipt("GLO900003");
    d.date = "05/10/2026";
    d.time = "9:5";
    d.lines[1].ln = d.lines[0].ln;
    d.tenders = [{ method: "", amount: "" }];
    const p = evaluate(d).problems.join("\n");
    expect(p).toMatch(/Date must be YYYY-MM-DD/);
    expect(p).toMatch(/Time must be HH:MM/);
    expect(p).toMatch(/Line number 1 appears twice/);
    expect(p).toMatch(/No tender line/);
  });
  it("non-numeric points are a problem, but blank points are allowed (optional)", () => {
    const d = draftFromReceipt("GLO900003");
    d.pointsEarned = "";
    d.pointsBalance = "";
    expect(evaluate(d).canSave).toBe(true);
    d.pointsEarned = "lots";
    expect(evaluate(d).problems.join()).toMatch(/Points earned is not a number/);
  });
});

describe("US-01 e-bill date validation", () => {
  it("rejects an impossible calendar date instead of rolling it over", () => {
    const bad = rawText("DEM003").replace(ebillDate(seedBill("DEM003").date), "31-Feb-2026");
    expect(() => parseBill(bad, "DEM003")).toThrow(/not a valid date/);
    const unknownMonth = rawText("DEM003").replace(ebillDate(seedBill("DEM003").date), "30-Xyz-2026");
    expect(() => parseBill(unknownMonth, "DEM003")).toThrow(/not a valid date/);
  });
  it("fails loudly when there is no date/time header or no item lines", () => {
    expect(() => parseBill("nothing here", "ZZZZZZ")).toThrow(/date\/time header/);
    expect(() => parseBill("30-Jul-2026 19:10:52 C:1 R:1", "ZZZZZZ")).toThrow(/no item lines/);
  });
});
