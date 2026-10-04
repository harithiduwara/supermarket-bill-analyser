import { describe, expect, it } from "vitest";
import { evaluate, fromOcr, lineStatus, blankDraft, type ReceiptDraft } from "../src/domain/draft";
import { receiptJson } from "./helpers";

function draftFromReceipt(ref: string): ReceiptDraft {
  const r = receiptJson(ref);
  return {
    prefix: "GLO", ticket: ref.replace("GLO", ""), store: r.store, storeCode: r.store_code, date: r.date, time: r.time,
    printedGross: String(r.printed.gross), printedDiscount: String(r.printed.discount), printedNet: String(r.printed.net),
    pointsEarned: String(r.points_earned), pointsBalance: String(r.points_balance_printed), loyaltyScheme: r.loyalty_scheme,
    tenders: r.tenders.map((t: any) => ({ method: t.method, amount: String(t.amount) })),
    lines: r.lines.map((l: any, i: number) => ({ ln: String(i + 1), code: l.code, name: l.name, rate: String(l.rate), qty: String(l.qty), discount: String(l.discount ?? 0), amount: String(l.amount), scheme: l.scheme ?? "" })),
  };
}

describe("receipt draft (OCR confirmation table logic)", () => {
  it("a correctly transcribed receipt can be saved", () => {
    const o = evaluate(draftFromReceipt("GLO549921"));
    expect(o.problems).toEqual([]);
    expect(o.canSave).toBe(true);
  });
  it("one wrong digit disables saving and names the line", () => {
    const d = draftFromReceipt("GLO549921");
    d.lines[6].amount = String(Number(d.lines[6].amount) + 10);
    expect(lineStatus(d.lines[6]).ok).toBe(false);
    const o = evaluate(d);
    expect(o.canSave).toBe(false);
    expect(o.checks.some((c) => c.id === "lineArithmetic" && !c.ok && /line 7 /.test(c.detail))).toBe(true);
  });
  it("a wrong printed total disables saving", () => {
    const d = draftFromReceipt("GLO549921");
    d.printedNet = String(Number(d.printedNet) + 1);
    expect(evaluate(d).canSave).toBe(false);
  });
  it("blank figures are problems, not zeros", () => {
    const d = draftFromReceipt("GLO549921");
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
    const d = fromOcr({ store: null, storeCode: null, ticket: null, date: null, time: null, printedGross: null, printedDiscount: null, printedNet: null,
      pointsEarned: null, pointsBalance: null, loyaltyScheme: null, tenders: [], lines: [{ ln: 1, code: "1", name: "X", rate: null, qty: 1, discount: 0, amount: 5, scheme: null }] });
    expect(d.lines[0].rate).toBe("");
    expect(evaluate(d).canSave).toBe(false);
  });
});
