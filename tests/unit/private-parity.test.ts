/** OPTIONAL: check the TypeScript port against the original Python tool on REAL bills, privately.
 *
 * Real bills must never be in this repository (docs/adr/0007). To run this check, point REAL_FIXTURES_DIR at a folder
 * OUTSIDE the repository containing `ledger.json` (the Python tool's ledger) and `raw/<REF>.md` (the fetched e-bill
 * text). Without it the suite is skipped — in CI, and for everyone but the original owner.
 *
 *   REAL_FIXTURES_DIR=/private/place npx vitest run tests/unit/private-parity.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBill } from "../../src/domain/parse";

const dir = process.env.REAL_FIXTURES_DIR;

describe.skipIf(!dir)("NFR-02 (private) the port reproduces the Python tool on real bills", () => {
  const ledger = dir
    ? (JSON.parse(fs.readFileSync(path.join(dir, "ledger.json"), "utf8")).bills as Record<string, any>)
    : {};
  const refs =
    dir && fs.existsSync(path.join(dir, "raw"))
      ? fs.readdirSync(path.join(dir, "raw")).map((f) => f.replace(/\.md$/, ""))
      : [];

  it("has fixtures to compare", () => expect(refs.length).toBeGreaterThan(0));
  for (const ref of refs) {
    it(`e-bill ${ref} parses identically to the Python`, () => {
      const t = parseBill(fs.readFileSync(path.join(dir as string, "raw", `${ref}.md`), "utf8"), ref);
      const p = ledger[ref];
      expect(t.date).toBe(p.date);
      expect([t.gross, t.discount, t.net]).toEqual([p.gross, p.discount, p.net]);
      expect(t.pointsEarned).toBe(p.points_earned);
      expect(t.pointsBalancePrinted).toBe(p.points_balance_printed);
      expect(t.tenders).toEqual(p.tenders);
      expect(t.promotions).toEqual(p.promotions);
      expect(t.items.map((i) => [i.code, i.name, i.unitPrice, i.qty, i.amount])).toEqual(
        p.items.map((i: any) => [i.code, i.name, i.unit_price, i.qty, i.amount]),
      );
    });
  }
});
