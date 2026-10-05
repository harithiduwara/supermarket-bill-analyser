/** View-model for the ledger list: filter, sort, page, totals. Pure, so it is unit-tested
 * (and performance-tested, NFR-08) instead of living inside a component.
 *
 * Totals are sums of the figures PRINTED on the bills in view. They are a floor for
 * Keells spend (trips missing from the ledger) — the UI must say so wherever it shows them. */
import { round, sum } from "./num";
import { allPass, reconcile } from "./reconcile";
import type { Bill } from "./types";

export type SortKey = "date" | "ref" | "store" | "lines" | "gross" | "discount" | "net";
export type SortDir = "asc" | "desc";

export interface LedgerQuery {
  text: string;
  source: "all" | string;
  /** YYYY-MM or "all" */
  month: string;
  sort: SortKey;
  dir: SortDir;
  /** rows to return (paged rendering) */
  limit: number;
}

export const defaultQuery: LedgerQuery = {
  text: "",
  source: "all",
  month: "all",
  sort: "date",
  dir: "desc",
  limit: 50,
};

export interface LedgerTotals {
  bills: number;
  gross: number;
  discount: number;
  net: number;
  keellsBills: number;
  keellsNet: number;
  /** discount / gross, 0 when no gross */
  discountRate: number;
  failing: number;
}

export interface LedgerView {
  rows: { bill: Bill; ok: boolean }[];
  /** how many bills match, before paging */
  matching: number;
  totals: LedgerTotals;
  months: string[];
  sources: string[];
}

const sortValue = (b: Bill, k: SortKey): string | number => {
  switch (k) {
    case "date":
      return b.date + b.time;
    case "ref":
      return b.ref;
    case "store":
      return b.store;
    case "lines":
      return b.items.length;
    default:
      return b[k];
  }
};

// One shared collator: calling String.localeCompare per comparison re-resolves ICU data each time
// and dominated the sort on a 5,000-bill ledger.
const collator = new Intl.Collator("en");

const haystack = (b: Bill): string =>
  `${b.ref} ${b.store} ${b.storeCode} ${b.items.map((i) => i.name).join(" ")}`.toLowerCase();

export function queryLedger(bills: Bill[], q: LedgerQuery): LedgerView {
  const text = q.text.trim().toLowerCase();
  const matched = bills.filter(
    (b) =>
      (q.source === "all" || b.source === q.source) &&
      (q.month === "all" || b.date.startsWith(q.month)) &&
      (!text || haystack(b).includes(text)),
  );
  const dir = q.dir === "asc" ? 1 : -1;
  // ref as a stable tie-break so equal keys never reorder between renders
  matched.sort((a, b) => {
    const x = sortValue(a, q.sort);
    const y = sortValue(b, q.sort);
    const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return c * dir || collator.compare(a.ref, b.ref);
  });

  const checked = matched.map((bill) => ({ bill, ok: allPass(reconcile(bill)) }));
  const keells = matched.filter((b) => b.source === "keells");
  const gross = round(sum(matched.map((b) => b.gross)));
  const discount = round(sum(matched.map((b) => b.discount)));
  return {
    rows: checked.slice(0, q.limit),
    matching: matched.length,
    totals: {
      bills: matched.length,
      gross,
      discount,
      net: round(sum(matched.map((b) => b.net))),
      keellsBills: keells.length,
      keellsNet: round(sum(keells.map((b) => b.net))),
      discountRate: gross ? discount / gross : 0,
      failing: checked.filter((r) => !r.ok).length,
    },
    months: [...new Set(bills.map((b) => b.date.slice(0, 7)))].sort().reverse(),
    sources: [...new Set(bills.map((b) => b.source))].sort(),
  };
}
