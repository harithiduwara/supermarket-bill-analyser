import { describe, expect, it } from "vitest";
import { parseBill } from "../../src/domain/parse";
import { buildReceipt } from "../../src/domain/receipt";
import { ledger, rawRefs, rawText, receiptInput, receiptJson, receiptRefs } from "./helpers";

describe("NFR-02 TS port reproduces the Python ledger (24 real bills)", () => {
  it("has the expected fixture size", () => {
    expect(rawRefs().length + receiptRefs().length).toBe(24);
    expect(Object.keys(ledger.bills).length).toBe(24);
  });

  for (const ref of rawRefs()) {
    it(`US-01 e-bill ${ref} parses identically to the Python`, () => {
      const t = parseBill(rawText(ref), ref);
      const p = ledger.bills[ref];
      expect(t.date).toBe(p.date);
      expect(t.time).toBe(p.time);
      expect(t.storeCode).toBe(p.store_code);
      expect(t.store).toBe(p.store);
      expect([t.gross, t.discount, t.net]).toEqual([p.gross, p.discount, p.net]);
      expect(t.pointsEarned).toBe(p.points_earned);
      expect(t.pointsBalancePrinted).toBe(p.points_balance_printed);
      expect(t.tenders).toEqual(p.tenders);
      expect(t.promotions).toEqual(p.promotions);
      expect(
        t.items.map(({ code, name, unitPrice, qty, amount }) => ({
          code,
          name,
          unit_price: unitPrice,
          qty,
          amount,
        })),
      ).toEqual(
        p.items.map(({ code, name, unit_price, qty, amount }: any) => ({
          code,
          name,
          unit_price,
          qty,
          amount,
        })),
      );
    });
  }

  for (const ref of receiptRefs()) {
    it(`US-02 receipt ${ref} builds identically to the Python`, () => {
      const t = buildReceipt(receiptInput(receiptJson(ref)));
      const p = ledger.bills[ref];
      expect([t.gross, t.discount, t.net]).toEqual([p.gross, p.discount, p.net]);
      expect(t.promotions).toEqual(p.promotions);
      expect(
        t.items.map((i) => [i.code, i.name, i.unitPrice, i.qty, i.amount, i.netAmount, i.lineDiscount]),
      ).toEqual(
        p.items.map((i: any) => [
          i.code,
          i.name,
          i.unit_price,
          i.qty,
          i.amount,
          i.net_amount,
          i.line_discount,
        ]),
      );
    });
  }

  it("US-01 covers both e-bill summary layouts (bullets and wide table row)", () => {
    const texts = rawRefs().map(rawText);
    expect(texts.some((t) => /^- Net Amount/m.test(t))).toBe(true);
    expect(texts.some((t) => /^\| Net Amount\s*\|/m.test(t))).toBe(true);
  });

  it("US-01 recognises the 'RewadzPay' misspelling as a tender", () => {
    const hit = rawRefs()
      .map((r) => parseBill(rawText(r), r))
      .flatMap((b) => b.tenders)
      .some((t) => /RewadzPay/.test(t.method));
    expect(hit).toBe(true);
  });
});
