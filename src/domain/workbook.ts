/** The workbook's DATA layer (ADR-0006): a normalised, lossless table form of the ledger and its inverse.
 *
 * Pure — no Excel library here. `billsToTables` is what the exporter writes into the `Data_*` sheets;
 * `tablesToBills` is what the importer reads back. The readable sheets (Summary, Bills, …) are never parsed.
 *
 * The reader is deliberately strict and inert: it takes values, never formulas; every number must really be a
 * number; child-row counts must match what the bill row declares (a truncated sheet is detected, not guessed
 * around); problems are reported per bill, never swallowed.
 */
import type { Bill } from "./types";

export const WORKBOOK_FORMAT = "grocery-ledger-workbook";
export const WORKBOOK_VERSION = 1;

/** Excel's hard limit is 32,767 characters per cell; stay clear of it. */
export const RAW_TEXT_PART = 30_000;

export type Cell = string | number | null;
/** A row as written. */
export type WriteRow = Record<string, Cell>;
/** A row as read from an untrusted file: anything can be in a cell, so nothing is assumed. */
export type Row = Record<string, unknown>;

export interface DataTables<R = Row> {
  bills: R[];
  items: R[];
  tenders: R[];
  promotions: R[];
  rawText: R[];
}

/** Column order of each Data sheet (header row text = field name, so the reader is order-independent). */
export const COLUMNS = {
  bills: [
    "ref",
    "source",
    "store",
    "storeCode",
    "date",
    "time",
    "gross",
    "discount",
    "net",
    "pointsEarned",
    "pointsBalancePrinted",
    "loyaltyScheme",
    "transcribedFrom",
    "notes",
    "itemCount",
    "tenderCount",
    "promotionCount",
    "rawTextParts",
  ],
  items: ["ref", "seq", "line", "code", "name", "unitPrice", "qty", "amount", "lineDiscount", "netAmount"],
  tenders: ["ref", "seq", "method", "amount"],
  promotions: ["ref", "seq", "scheme", "line", "code", "pct", "amount"],
  rawText: ["ref", "part", "text"],
} as const satisfies Record<keyof DataTables, readonly string[]>;

export const SHEET = {
  bills: "Data_Bills",
  items: "Data_Items",
  tenders: "Data_Tenders",
  promotions: "Data_Promotions",
  rawText: "Data_RawText",
} as const satisfies Record<keyof DataTables, string>;

const nn = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function billsToTables(bills: Bill[]): DataTables<WriteRow> {
  const t: DataTables<WriteRow> = { bills: [], items: [], tenders: [], promotions: [], rawText: [] };
  const sorted = [...bills].sort((a, b) => (a.date + a.time + a.ref).localeCompare(b.date + b.time + b.ref));
  for (const b of sorted) {
    const parts = b.rawText ? Math.ceil(b.rawText.length / RAW_TEXT_PART) : 0;
    t.bills.push({
      ref: b.ref,
      source: b.source,
      store: b.store,
      storeCode: b.storeCode,
      date: b.date,
      time: b.time,
      gross: b.gross,
      discount: b.discount,
      net: b.net,
      pointsEarned: nn(b.pointsEarned),
      pointsBalancePrinted: nn(b.pointsBalancePrinted),
      loyaltyScheme: nn(b.loyaltyScheme),
      transcribedFrom: nn(b.transcribedFrom),
      notes: nn(b.notes),
      itemCount: b.items.length,
      tenderCount: b.tenders.length,
      promotionCount: b.promotions.length,
      rawTextParts: parts,
    });
    b.items.forEach((i, k) =>
      t.items.push({
        ref: b.ref,
        seq: k + 1,
        line: nn(i.line),
        code: i.code,
        name: i.name,
        unitPrice: i.unitPrice,
        qty: i.qty,
        amount: i.amount,
        lineDiscount: nn(i.lineDiscount),
        netAmount: nn(i.netAmount),
      }),
    );
    b.tenders.forEach((x, k) =>
      t.tenders.push({ ref: b.ref, seq: k + 1, method: x.method, amount: x.amount }),
    );
    b.promotions.forEach((p, k) =>
      t.promotions.push({
        ref: b.ref,
        seq: k + 1,
        scheme: nn(p.scheme),
        line: nn(p.line),
        code: nn(p.code),
        pct: nn(p.pct),
        amount: p.amount,
      }),
    );
    for (let i = 0; i < parts; i++) {
      t.rawText.push({
        ref: b.ref,
        part: i + 1,
        text: (b.rawText as string).slice(i * RAW_TEXT_PART, (i + 1) * RAW_TEXT_PART),
      });
    }
  }
  return t;
}

export interface ReadProblem {
  ref: string | null;
  reason: string;
}
export interface ReadResult {
  /** unvalidated bill objects — they still go through schema validation and reconcile() */
  bills: unknown[];
  problems: ReadProblem[];
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

class Bad extends Error {}

/** Marker the reader puts in a cell that held a formula (or an error): formulas are never evaluated. */
export const FORMULA = { formula: true } as const;
const isFormula = (v: unknown): boolean => typeof v === "object" && v !== null && "formula" in v;

const str = (v: unknown, what: string, required = false): string | null => {
  if (isFormula(v)) throw new Bad(`${what} contains a formula — formulas are never evaluated`);
  if (v === null || v === undefined || v === "") {
    if (required) throw new Bad(`${what} is empty`);
    return null;
  }
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v); // e.g. a code Excel turned into a number
  throw new Bad(`${what} is not text`);
};

const num = (v: unknown, what: string, required = false): number | null => {
  if (isFormula(v)) throw new Bad(`${what} contains a formula — formulas are never evaluated`);
  if (v === null || v === undefined || v === "") {
    if (required) throw new Bad(`${what} is empty`);
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && NUMERIC.test(v.trim())) return Number(v);
  throw new Bad(`${what} is not a number`);
};

const group = (rows: Row[], seqKey: string): Map<string, Row[]> => {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const ref =
      typeof r.ref === "string" ? r.ref : r.ref === null || r.ref === undefined ? "" : String(r.ref);
    m.set(ref, [...(m.get(ref) ?? []), r]);
  }
  for (const list of m.values()) list.sort((a, b) => Number(a[seqKey]) - Number(b[seqKey]));
  return m;
};

export function tablesToBills(t: DataTables): ReadResult {
  const problems: ReadProblem[] = [];
  const bills: unknown[] = [];
  const items = group(t.items, "seq");
  const tenders = group(t.tenders, "seq");
  const promos = group(t.promotions, "seq");
  const raws = group(t.rawText, "part");
  const seen = new Set<string>();

  for (const row of t.bills) {
    let ref: string | null = null;
    try {
      ref = str(row.ref, "ref", true);
      if (seen.has(ref as string)) throw new Bad("appears twice in the file; the first one is used");
      seen.add(ref as string);
      const r = ref as string;

      const its = items.get(r) ?? [];
      const tns = tenders.get(r) ?? [];
      const prs = promos.get(r) ?? [];
      const rws = raws.get(r) ?? [];
      const expect = (what: string, got: number, declared: unknown) => {
        const d = num(declared, `${what} count`, true);
        if (d !== got)
          throw new Bad(
            `the file declares ${d} ${what} but contains ${got} — the sheet looks truncated or edited`,
          );
      };
      expect("lines", its.length, row.itemCount);
      expect("tenders", tns.length, row.tenderCount);
      expect("promotions", prs.length, row.promotionCount);
      expect("raw-text parts", rws.length, row.rawTextParts ?? 0);

      const bill: Record<string, unknown> = {
        ref: r,
        source: str(row.source, "source", true),
        store: str(row.store, "store") ?? "",
        storeCode: str(row.storeCode, "storeCode") ?? "",
        date: str(row.date, "date", true),
        time: str(row.time, "time") ?? "",
        gross: num(row.gross, "gross", true),
        discount: num(row.discount, "discount", true),
        net: num(row.net, "net", true),
        pointsEarned: num(row.pointsEarned, "pointsEarned"),
        pointsBalancePrinted: num(row.pointsBalancePrinted, "pointsBalancePrinted"),
        tenders: tns.map((x, k) => ({
          method: str(x.method, `tender ${k + 1} method`, true),
          amount: num(x.amount, `tender ${k + 1} amount`, true),
        })),
        promotions: prs.map((p, k) => ({
          scheme: str(p.scheme, `promotion ${k + 1} scheme`),
          line: num(p.line, `promotion ${k + 1} line`),
          code: str(p.code, `promotion ${k + 1} code`),
          pct: num(p.pct, `promotion ${k + 1} pct`),
          amount: num(p.amount, `promotion ${k + 1} amount`, true),
        })),
        items: its.map((i, k) => {
          const o: Record<string, unknown> = {
            code: str(i.code, `line ${k + 1} code`, true),
            name: str(i.name, `line ${k + 1} name`, true),
            unitPrice: num(i.unitPrice, `line ${k + 1} unitPrice`, true),
            qty: num(i.qty, `line ${k + 1} qty`, true),
            amount: num(i.amount, `line ${k + 1} amount`, true),
          };
          const line = num(i.line, `line ${k + 1} number`);
          const ld = num(i.lineDiscount, `line ${k + 1} discount`);
          const na = num(i.netAmount, `line ${k + 1} netAmount`);
          if (line !== null) o.line = line;
          if (ld !== null) o.lineDiscount = ld;
          if (na !== null) o.netAmount = na;
          return o;
        }),
      };
      for (const k of ["loyaltyScheme", "transcribedFrom", "notes"] as const) {
        const v = str(row[k], k);
        if (v !== null) bill[k] = v;
      }
      if (rws.length) bill.rawText = rws.map((p) => str(p.text, "raw text", true)).join("");
      bills.push(bill);
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push({ ref, reason: e.message });
    }
  }

  const known = new Set(t.bills.map((b) => String(b.ref ?? "")));
  for (const [name, m] of [
    ["lines", items],
    ["tenders", tenders],
    ["promotions", promos],
    ["raw text", raws],
  ] as const) {
    const orphans = [...m.keys()].filter((r) => !known.has(r));
    if (orphans.length)
      problems.push({
        ref: null,
        reason: `${name} rows reference bills that are not in Data_Bills (${orphans.slice(0, 5).join(", ")}${orphans.length > 5 ? "…" : ""}) and were ignored`,
      });
  }
  return { bills, problems };
}

/** Fixed-shape, key-sorted JSON of a bill, for equality and checksums. Optional fields that are empty are
 * omitted (so null / undefined / "" compare equal); the two required-nullable points fields keep null. */
export function canonical(b: Bill): string {
  const o: Record<string, unknown> = {
    ref: b.ref,
    source: b.source,
    store: b.store,
    storeCode: b.storeCode,
    date: b.date,
    time: b.time,
    gross: b.gross,
    discount: b.discount,
    net: b.net,
    pointsEarned: nn(b.pointsEarned),
    pointsBalancePrinted: nn(b.pointsBalancePrinted),
    tenders: b.tenders.map((t) => ({ method: t.method, amount: t.amount })),
    promotions: b.promotions.map((p) => ({
      scheme: nn(p.scheme),
      line: nn(p.line),
      code: nn(p.code),
      pct: nn(p.pct),
      amount: p.amount,
    })),
    items: b.items.map((i) => {
      const x: Record<string, unknown> = {
        code: i.code,
        name: i.name,
        unitPrice: i.unitPrice,
        qty: i.qty,
        amount: i.amount,
      };
      if (i.line !== undefined && i.line !== null) x.line = i.line;
      if (i.lineDiscount !== undefined && i.lineDiscount !== null) x.lineDiscount = i.lineDiscount;
      if (i.netAmount !== undefined && i.netAmount !== null) x.netAmount = i.netAmount;
      return x;
    }),
  };
  for (const k of ["loyaltyScheme", "transcribedFrom", "notes", "rawText"] as const) {
    const v = b[k];
    if (v !== undefined && v !== null && v !== "") o[k] = v;
  }
  return JSON.stringify(sortKeys(o));
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, sortKeys(x)]),
        )
      : v;

/** SHA-256 over the canonical bills (sorted by ref). null if Web Crypto is unavailable. */
export async function ledgerChecksum(bills: Bill[]): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const text = [...bills]
    .sort((a, b) => a.ref.localeCompare(b.ref))
    .map(canonical)
    .join("\n");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
