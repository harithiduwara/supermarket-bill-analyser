/** Keells e-bill text -> canonical Bill. Port of keells-bill-analysis/scripts/parse_bill.py.
 *
 * Input is the TEXT of the bill page. The patterns are ported verbatim; do not
 * "tidy" them. Deliberate differences from the Python (design rule 4, never
 * invent a figure):
 *  - missing Gross/Net Amount throws instead of defaulting to 0.00
 *  - missing points lines become null instead of 0.00
 * A missing Promotion Discount still means 0: bills with no discount omit it.
 */
import { STORE_NAMES } from "./rules";
import type { Bill, BillItem, Promotion, Tender } from "./types";

const ITEM_RE =
  /^\|\s*(\d+)\s*\|\s*([A-Za-z0-9]+):\s*(.+?)\s*\|\s*([\d,]+\.\d{2})\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d,]+\.\d{2})\s*\|/;
const HEADER_RE = /(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2}:\d{2})(?:\s+C:(\d+))?(?:\s+R:(\d+))?/;
const STORECODE_RE = /Store Code:\s*([A-Z0-9]+)/;
// summary values appear either as "- Gross Amount 4,367.56" or in a table row
const SUMMARY_RE = {
  gross: /Gross Amount[^\d-]*([\d,]+\.\d{2})/,
  discount: /Promotion Discount[^\d-]*([\d,]+\.\d{2})/,
  net: /Net Amount[^\d-]*([\d,]+\.\d{2})/,
};
const POINTS_RE = /Points earned for this bill:\s*([\d,]+\.\d+)/;
const BALANCE_RE =
  /Total points redeemable as at\s+\d{2}-[A-Za-z]{3}-\d{4}\s+([\d,]+\.\d+)/;
const TRAILING_AMOUNT_RE = /^(.*?)\s+(-?[\d,]+\.\d{2})$/;
const LINE_PROMO_RE = /^(\d+)\s+([A-Za-z0-9]+)\s+(?:([\d.]+)%\s+)?(?:Value\s+)?Dis$/i;

// summary rows already captured elsewhere; never treat these as tender or promo
const SKIP_LABELS =
  /Gross Amount|Promotion Discount|Net Amount|Total promotion\(s\) savings|Points earned|Total points redeemable/i;
// a payment instrument, not a discount scheme.
// NB the bill misspells RewardzPay as "RewadzPay" on Seylan lines.
const TENDER_HINT =
  /Credit Card|Debit Card|\bCash\b|Rew[a-z]*Pay|Voucher|Gift Card|\bLoyalty\b|Bank\s*-/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const num = (s: string): number => parseFloat(s.replace(/,/g, "").trim());

function parseDate(s: string): string {
  const [dd, mon, yyyy] = s.split("-");
  const m = MONTHS[mon.toLowerCase()];
  const d = Number(dd);
  const y = Number(yyyy);
  const probe = new Date(Date.UTC(y, (m ?? 1) - 1, d));
  if (!m || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`not a valid date: ${s}`);
  }
  return `${yyyy}-${String(m).padStart(2, "0")}-${dd}`;
}

/** Flatten both summary layouts into plain 'label value' strings.
 *
 * Keells renders the totals block either as markdown bullets
 * ('- Net Amount 1,370.00') or as a wide table row
 * ('| Net Amount | | | | | | 1,370.00 |'), depending on whether the bill had a
 * discount. Normalising first means the classifier only handles one shape. */
export function normaliseSummaryLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || [...s].every((ch) => "|- ".includes(ch))) continue;
    if (s.startsWith("|") && s.endsWith("|")) {
      const cells = s
        .replace(/^\|+|\|+$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c);
      if (cells.length === 2) out.push(`${cells[0]} ${cells[1]}`);
      continue;
    }
    out.push(s.replace(/^-+/, "").trim());
  }
  return out;
}

/** Best-effort conversion of a pasted page's HTML to the pipe-table text the
 * parser expects. UNVERIFIED against the live digibill HTML (the host is not
 * reachable from the build sandbox and the seed holds only fetched text). If a
 * real bill fails to parse, the first fix to try is pasting the visible text. */
export function htmlToText(html: string): string {
  if (!/<\w+[^>]*>/.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((n) => n.remove());
  doc.querySelectorAll("tr").forEach((tr) => {
    const cells = [...tr.querySelectorAll("th,td")].map((c) =>
      (c.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    tr.textContent = `| ${cells.join(" | ")} |\n`;
  });
  doc.querySelectorAll("br,p,div,li,h1,h2,h3,h4").forEach((n) => n.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n");
}

export function parseBill(text: string, ref: string): Bill {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));

  const m = HEADER_RE.exec(text);
  if (!m) throw new Error(`${ref}: could not find the date/time header line`);
  const date = parseDate(m[1]);

  const sc = STORECODE_RE.exec(text);
  const storeCode = sc ? sc[1] : "UNKNOWN";

  const items: BillItem[] = [];
  for (const line of lines) {
    const im = ITEM_RE.exec(line);
    if (!im) continue;
    const [, ln, code, name, price, qty, amount] = im;
    items.push({
      line: Number(ln),
      code,
      name: name.replace(/\s+/g, " ").trim(),
      unitPrice: num(price),
      qty: parseFloat(qty),
      amount: num(amount),
    });
  }
  if (!items.length) throw new Error(`${ref}: no item lines matched`);

  const required = (key: "gross" | "net", label: string): number => {
    const mm = SUMMARY_RE[key].exec(text);
    if (!mm) throw new Error(`${ref}: no "${label}" line found — not guessing it`);
    return num(mm[1]);
  };
  const gross = required("gross", "Gross Amount");
  const net = required("net", "Net Amount");
  const dm = SUMMARY_RE.discount.exec(text);
  const discount = dm ? num(dm[1]) : 0;

  // The block below the items table mixes summary rows, payment tenders,
  // bill-level promotions, bare scheme headings and line-level discounts.
  // Walk it once, carrying the most recent heading forward.
  const tenders: Tender[] = [];
  const promotions: Promotion[] = [];
  let heading: string | null = null;
  for (const s of normaliseSummaryLines(lines)) {
    if (SKIP_LABELS.test(s)) continue;
    const am = TRAILING_AMOUNT_RE.exec(s);
    if (!am) {
      // no amount => it is a scheme heading for the lines that follow
      if (/Deal|Nexus|Quick|Discount|off on|%/i.test(s)) heading = s;
      continue;
    }
    const label = am[1].trim();
    const amount = num(am[2]);
    const lp = LINE_PROMO_RE.exec(label);
    if (lp) {
      promotions.push({
        scheme: heading,
        line: Number(lp[1]),
        code: lp[2],
        pct: lp[3] ? parseFloat(lp[3]) : null,
        amount,
      });
    } else if (TENDER_HINT.test(label)) {
      tenders.push({ method: label, amount });
    } else {
      // a bill-level promotion such as "NTB | 25% off on Fresh 713.00";
      // it also heads any line discounts printed beneath it
      promotions.push({ scheme: label, line: null, code: null, pct: null, amount });
      heading = label;
    }
  }

  const pm = POINTS_RE.exec(text);
  const bm = BALANCE_RE.exec(text);

  return {
    ref,
    source: "keells",
    date,
    time: m[2].slice(0, 5),
    storeCode,
    store: STORE_NAMES[storeCode] ?? storeCode,
    gross,
    discount,
    net,
    pointsEarned: pm ? num(pm[1]) : null,
    pointsBalancePrinted: bm ? num(bm[1]) : null,
    tenders,
    promotions,
    items,
    rawText: text,
  };
}
