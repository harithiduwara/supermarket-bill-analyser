/** The reconciliation checks. A failure blocks the save (design rule 3).
 *
 * Five bill-level checks plus, for photo receipts, a per-line arithmetic check
 * (rate x qty - discount = amount). Tolerance is TOLERANCE (0.02) and must not
 * be widened to make a bill pass.
 *
 * Every check compares against the totals AS PRINTED on the bill. The point of
 * the exercise is that a wrong digit surfaces here instead of poisoning every
 * downstream figure.
 */
import { money, round, sum } from "./num";
import { POINTS_RATE, TOLERANCE } from "./rules";
import type { Bill, CheckResult } from "./types";

// Differences between two 2-dp figures are whole cents, so round first: a raw
// float diff of 0.0200000000001 must not flip a cent-exact comparison.
const within = (diff: number): boolean => Math.abs(round(diff)) < TOLERANCE;

const diffNote = (d: number): string => {
  const r = round(d);
  return `diff ${r > 0 ? "+" : ""}${money(r === 0 ? 0 : r)}`; // never "-0.00"
};

export function reconcile(b: Bill): CheckResult[] {
  const itemSum = round(sum(b.items.map((i) => i.amount)));
  const tenderSum = round(sum(b.tenders.map((t) => t.amount)));
  const promoSum = round(sum(b.promotions.map((p) => p.amount)));

  const checks: CheckResult[] = [];

  {
    const d = itemSum - b.gross;
    checks.push({
      id: "itemsEqualGross",
      label: "Line items sum to printed gross",
      applicable: true,
      ok: within(d),
      detail: `${b.items.length} lines sum to ${money(itemSum)}; printed gross ${money(b.gross)} (${diffNote(d)})`,
    });
  }
  {
    const d = b.gross - b.discount - b.net;
    checks.push({
      id: "grossLessDiscountEqualsNet",
      label: "Gross − discount = net",
      applicable: true,
      ok: within(d),
      detail: `${money(b.gross)} − ${money(b.discount)} = ${money(round(b.gross - b.discount))}; printed net ${money(b.net)} (${diffNote(d)})`,
    });
  }
  {
    const d = tenderSum - b.net;
    checks.push({
      id: "tendersEqualNet",
      label: "Tender lines sum to net",
      applicable: true,
      ok: within(d),
      detail: `${b.tenders.length} tender line(s) sum to ${money(tenderSum)}; printed net ${money(b.net)} (${diffNote(d)})`,
    });
  }
  {
    const d = promoSum - b.discount;
    checks.push({
      id: "promoLinesEqualDiscount",
      label: "Promotion lines sum to the discount",
      applicable: true,
      ok: within(d),
      detail: `${b.promotions.length} promotion line(s) sum to ${money(promoSum)}; printed discount ${money(b.discount)} (${diffNote(d)})`,
    });
  }

  const keells = b.source === "keells";
  if (!keells) {
    checks.push({
      id: "pointsMatchRate",
      label: "Points earned = 0.34% of net",
      applicable: false,
      ok: true,
      detail: "Keells only — Softlogic points follow no flat rate, so none is derived",
    });
  } else if (b.pointsEarned === null) {
    checks.push({
      id: "pointsMatchRate",
      label: "Points earned = 0.34% of net",
      applicable: true,
      ok: false,
      detail: "no 'Points earned for this bill' line found on the bill — not assuming 0",
    });
  } else {
    const expected = b.net * POINTS_RATE;
    const d = b.pointsEarned - expected;
    checks.push({
      id: "pointsMatchRate",
      label: "Points earned = 0.34% of net",
      applicable: true,
      ok: Math.abs(d) < TOLERANCE, // raw, as in the Python: points are not 2-dp
      detail: `earned ${b.pointsEarned.toFixed(2)}; 0.34% × ${money(b.net)} = ${expected.toFixed(2)} (${diffNote(d)})`,
    });
  }

  const photo = b.items.some((i) => i.netAmount !== undefined);
  if (photo) {
    // NB the Python allows up to and including 0.02 here (`> 0.02` fails), a
    // little looser than the bill-level checks, because rate x qty carries up
    // to five decimals before rounding. Ported as is.
    const bad: string[] = [];
    b.items.forEach((i, idx) => {
      const calc = round(i.unitPrice * i.qty - (i.lineDiscount ?? 0));
      if (Math.abs(calc - (i.netAmount as number)) > 0.02) {
        bad.push(
          `line ${i.line ?? idx + 1} (${i.code} ${i.name}): ${money(i.unitPrice)} × ${i.qty} − ${money(i.lineDiscount ?? 0)} = ${money(calc)}, receipt says ${money(i.netAmount as number)}`,
        );
      }
    });
    checks.push({
      id: "lineArithmetic",
      label: "Every line: rate × qty − discount = amount",
      applicable: true,
      ok: bad.length === 0,
      detail: bad.length ? bad.join("; ") : `all ${b.items.length} lines tie`,
    });
  }
  return checks;
}

export const allPass = (checks: CheckResult[]): boolean => checks.every((c) => !c.applicable || c.ok);

export const failures = (checks: CheckResult[]): CheckResult[] => checks.filter((c) => c.applicable && !c.ok);
