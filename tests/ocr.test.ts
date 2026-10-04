import { describe, expect, it } from "vitest";
import { mergeDrafts, type OcrDraft, type OcrLine } from "../src/domain/ocr";

const line = (ln: number, over: Partial<OcrLine> = {}): OcrLine => ({
  ln, code: `C${ln}`, name: `ITEM ${ln}`, rate: 10, qty: 1, discount: 0, amount: 10, scheme: null, ...over,
});
const draft = (lines: OcrLine[], over: Partial<OcrDraft> = {}): OcrDraft => ({
  store: null, storeCode: null, ticket: null, date: null, time: null,
  printedGross: null, printedDiscount: null, printedNet: null,
  pointsEarned: null, pointsBalance: null, loyaltyScheme: null, tenders: [], lines, ...over,
});

describe("merging overlapping photos", () => {
  it("de-duplicates on line number, not position", () => {
    const a = draft([line(1), line(2), line(3)], { store: "Glomark", date: "2026-09-02" });
    const b = draft([line(3), line(4)], { printedNet: 40, tenders: [{ method: "Visa", amount: 40 }] });
    const { draft: d, conflicts } = mergeDrafts([a, b]);
    expect(d.lines.map((l) => l.ln)).toEqual([1, 2, 3, 4]);
    expect(conflicts).toEqual([]);
    expect(d.store).toBe("Glomark");
    expect(d.printedNet).toBe(40);
  });
  it("is not fooled when the overlap sits at a different position", () => {
    const a = draft([line(1), line(2)]);
    const b = draft([line(2), line(1)]);
    expect(mergeDrafts([a, b]).draft.lines).toHaveLength(2);
  });
  it("reports a disagreement on an overlapping line instead of hiding it", () => {
    const a = draft([line(5, { amount: 120 })]);
    const b = draft([line(5, { amount: 129 })]);
    const { draft: d, conflicts } = mergeDrafts([a, b]);
    expect(d.lines[0].amount).toBe(120);
    expect(conflicts[0]).toMatch(/line 5.*amount/);
  });
  it("does not duplicate a tender printed in both photos", () => {
    const t = { method: "Visa", amount: 5 };
    expect(mergeDrafts([draft([], { tenders: [t] }), draft([], { tenders: [t] })]).draft.tenders).toHaveLength(1);
  });
  it("warns about lines it cannot de-duplicate", () => {
    const { conflicts } = mergeDrafts([draft([line(1, { ln: null })])]);
    expect(conflicts[0]).toMatch(/no readable line number/);
  });
});
