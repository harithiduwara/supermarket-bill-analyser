import { describe, expect, it } from "vitest";
import { mergeDrafts, type OcrDraft, type OcrLine } from "../../src/domain/ocr";

const line = (ln: number, over: Partial<OcrLine> = {}): OcrLine => ({
  ln,
  code: `C${ln}`,
  name: `ITEM ${ln}`,
  rate: 10,
  qty: 1,
  discount: 0,
  amount: 10,
  scheme: null,
  ...over,
});
const draft = (lines: OcrLine[], over: Partial<OcrDraft> = {}): OcrDraft => ({
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
  lines,
  ...over,
});

describe("US-02 merging overlapping photos", () => {
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
    expect(
      mergeDrafts([draft([], { tenders: [t] }), draft([], { tenders: [t] })]).draft.tenders,
    ).toHaveLength(1);
  });
  it("warns about lines it cannot de-duplicate", () => {
    const { conflicts } = mergeDrafts([draft([line(1, { ln: null })])]);
    expect(conflicts[0]).toMatch(/no readable line number/);
  });
});

import { fromToolInput, MAX_OCR_LINES } from "../../src/domain/ocr";

describe("US-02 / NFR-03 OCR output is untrusted (threat model: prompt injection / malformed output)", () => {
  it("turns wrong types into null instead of trusting or throwing", () => {
    const d = fromToolInput({
      store: 42,
      date: { x: 1 },
      printed_net: "13,832.64",
      points_earned: Infinity,
      tenders: "Visa",
      lines: [
        { ln: "1", code: 5, name: "OK", rate: "10", qty: 1, discount: null, amount: NaN, scheme: ["x"] },
      ],
    });
    expect(d.store).toBeNull();
    expect(d.date).toBeNull();
    expect(d.printedNet).toBeNull(); // a string is NOT silently parsed into a figure
    expect(d.pointsEarned).toBeNull();
    expect(d.tenders).toEqual([]);
    expect(d.lines[0]).toMatchObject({
      ln: null,
      code: null,
      name: "OK",
      rate: null,
      qty: 1,
      amount: null,
      scheme: null,
    });
  });
  it("survives garbage at the top level", () => {
    for (const junk of [null, undefined, 7, "str", [], { lines: 3 }]) {
      const d = fromToolInput(junk);
      expect(d.lines).toEqual([]);
      expect(d.tenders).toEqual([]);
    }
  });
  it("caps the number of lines and the length of strings", () => {
    const lines = Array.from({ length: MAX_OCR_LINES + 50 }, (_, i) => ({ ln: i, name: "x".repeat(5000) }));
    const d = fromToolInput({ lines });
    expect(d.lines).toHaveLength(MAX_OCR_LINES);
    expect(d.lines[0].name!.length).toBeLessThanOrEqual(200);
  });
  it("drops tenders without a method or amount", () => {
    const d = fromToolInput({
      tenders: [{ method: "Visa", amount: 5 }, { method: "", amount: 1 }, { method: "Cash" }],
    });
    expect(d.tenders).toEqual([{ method: "Visa", amount: 5 }]);
  });
});
