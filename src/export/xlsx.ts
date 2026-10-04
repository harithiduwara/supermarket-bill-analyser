/** XLSX adapter (ExcelJS, loaded lazily — it is ~250 kB gzip and only needed to export or import).
 *
 * WRITE: readable sheets for people + `Data_*` sheets for the importer (ADR-0006). Totals are formulas that carry
 * their calculated value, so nothing shows blank before Excel recalculates.
 * READ: only `About` and `Data_*` are read, by header name, values only. Formulas are never evaluated.
 */
import { RULES_VERSION } from "../domain/rules";
import { failures, reconcile } from "../domain/reconcile";
import { round } from "../domain/num";
import { byPayment, byStore, headline, monthlyTrend } from "../domain/summary";
import type { Bill } from "../domain/types";
import {
  COLUMNS,
  FORMULA,
  SHEET,
  WORKBOOK_FORMAT,
  WORKBOOK_VERSION,
  billsToTables,
  ledgerChecksum,
  type DataTables,
  type Row,
} from "../domain/workbook";
import { WorkbookError, type WorkbookMeta } from "./errors";
import type { CellValue, Workbook, Worksheet, Cell as XCell, Fill } from "exceljs";

export const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
/** Row caps per Data sheet — a crafted file cannot make the importer build millions of objects. */
export const MAX_ROWS = {
  bills: 20_001,
  items: 400_001,
  tenders: 100_001,
  promotions: 100_001,
  rawText: 100_001,
} as const;

export interface ExportMeta {
  exportedAt: Date;
  appVersion: string;
}

const FONT = "Arial";
const MONEY = "#,##0.00;(#,##0.00);-";
const PCT = "0.0%";
const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const HDR = solid("FF1F3864");
const BAND = solid("FFD9E2F3");
const FLAG = solid("FFFFF2CC");
const GREY = "FF7F7F7F";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dateCell = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);

async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Grocery bill ledger";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true }; // Excel / LibreOffice recompute on open; cached results serve everything else
  return wb;
}

function header(
  ws: Worksheet,
  rowNo: number,
  labels: readonly string[],
  fill: Fill = HDR,
  color = "FFFFFFFF",
): void {
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: color } };
    c.fill = fill;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

const title = (ws: Worksheet, text: string, note?: string): void => {
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { name: FONT, size: 13, bold: true, color: { argb: "FF1F3864" } };
  if (note) {
    ws.getCell("A2").value = note;
    ws.getCell("A2").font = { name: FONT, size: 9, italic: true, color: { argb: "FF595959" } };
  }
};

const band = (ws: Worksheet, row: number, text: string, span: number): void => {
  for (let c = 1; c <= span; c++) ws.getRow(row).getCell(c).fill = BAND;
  ws.getRow(row).getCell(1).value = text;
  ws.getRow(row).getCell(1).font = { name: FONT, size: 10, bold: true };
};

const body = (c: XCell, fmt?: string, bold = false): void => {
  c.font = { name: FONT, size: 10, bold };
  if (fmt) c.numFmt = fmt;
};

/** A formula that carries its calculated value. ExcelJS drops a cached result of exactly 0, which would leave the
 * cell blank in any viewer that does not recalculate (Preview, Google Sheets import, pandas…) — so a zero is
 * written as the plain number 0 instead. */
const fx = (formula: string, result: number): CellValue => (result === 0 ? 0 : { formula, result });

const widths = (ws: Worksheet, w: number[]): void => w.forEach((x, i) => (ws.getColumn(i + 1).width = x));

export async function buildWorkbook(bills: Bill[], meta: ExportMeta): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  const sorted = [...bills].sort((a, b) => (a.date + a.time + a.ref).localeCompare(b.date + b.time + b.ref));
  const h = headline(sorted);
  const month = monthlyTrend(sorted);

  // ------------------------------------------------------------------ Summary
  const sum = wb.addWorksheet("Summary");
  title(
    sum,
    "Grocery ledger",
    h.bills
      ? `${h.bills} bills, ${h.first} to ${h.last} (${h.days} days). Exported ${meta.exportedAt.toISOString().slice(0, 10)} by Grocery bill ledger v${meta.appVersion}.`
      : "No bills in the ledger.",
  );

  // ------------------------------------------------------------------ Bills (built first: Summary refers to it)
  const bs = wb.addWorksheet("Bills");
  title(
    bs,
    "One row per bill",
    "Figures are exactly as printed on each bill. Checks re-run the reconciliation at export time.",
  );
  const bCols = [
    "Date",
    "Month",
    "Weekday",
    "Time",
    "Store",
    "Bill ref",
    "Source",
    "Lines",
    "Gross (Rs)",
    "Discount (Rs)",
    "Net (Rs)",
    "Discount %",
    "Payment method(s)",
    "Points earned",
    "Checks",
  ];
  header(bs, 3, bCols);
  let r = 4;
  for (const b of sorted) {
    const row = bs.getRow(r);
    const failing = failures(reconcile(b));
    const vals: (string | number | Date | null)[] = [
      dateCell(b.date),
      b.date.slice(0, 7),
      WEEKDAY.format(dateCell(b.date)),
      b.time,
      b.store,
      b.ref,
      b.source,
      b.items.length,
      b.gross,
      b.discount,
      b.net,
      null,
      b.tenders
        .map((t) => `${t.method} ${t.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)
        .join(" + "),
      b.pointsEarned,
      failing.length ? failing.map((f) => f.label).join("; ") : "OK",
    ];
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      if (v !== null) c.value = v;
      body(c, i === 0 ? "dd-mmm-yyyy" : i >= 8 && i <= 10 ? MONEY : i === 13 ? "#,##0.00" : undefined);
    });
    const d = row.getCell(12);
    d.value = fx(`IFERROR(J${r}/I${r},0)`, b.gross ? b.discount / b.gross : 0);
    body(d, PCT);
    if (failing.length) row.getCell(15).fill = FLAG;
    r++;
  }
  const bLast = r - 1;
  bs.getCell(r, 5).value = "TOTAL";
  body(bs.getCell(r, 5), undefined, true);
  const bTot: [number, number][] = [
    [8, h.lines],
    [9, h.gross],
    [10, h.discount],
    [11, h.net],
  ];
  for (const [col, result] of bTot) {
    const L = bs.getColumn(col).letter;
    const c = bs.getCell(r, col);
    c.value = bLast >= 4 ? fx(`SUM(${L}4:${L}${bLast})`, result) : 0;
    body(c, col === 8 ? "#,##0" : MONEY, true);
  }
  const rate = bs.getCell(r, 12);
  rate.value = fx(`IFERROR(J${r}/I${r},0)`, h.discountRate);
  body(rate, PCT, true);
  widths(bs, [12, 9, 9, 7, 18, 11, 9, 7, 13, 13, 13, 11, 52, 12, 30]);
  bs.views = [{ state: "frozen", ySplit: 3 }];
  if (bLast >= 4) bs.autoFilter = { from: "A3", to: `O${bLast}` };

  // ------------------------------------------------------------------ Summary body
  band(sum, 4, "HEADLINE", 3);
  const BR = `Bills!`;
  const rng = (L: string) => `${BR}${L}4:${L}${Math.max(bLast, 4)}`;
  const headRows: [string, string | number, number | string, string][] = [
    ["Bills", h.bills ? `COUNT(${rng("I")})` : 0, h.bills, "#,##0"],
    ["Bill lines", h.bills ? `SUM(${rng("H")})` : 0, h.lines, "#,##0"],
    ["Gross (Rs)", h.bills ? `SUM(${rng("I")})` : 0, h.gross, MONEY],
    ["Discount (Rs)", h.bills ? `SUM(${rng("J")})` : 0, h.discount, MONEY],
    ["Net paid, all itemised bills (Rs)", h.bills ? `SUM(${rng("K")})` : 0, h.net, MONEY],
    ["Effective discount rate", "B8/B7", h.discountRate, PCT],
    ["Average basket, net (Rs)", h.bills ? "B9/B5" : 0, h.averageBasket, MONEY],
    ["Median basket, net (Rs)", h.bills ? `MEDIAN(${rng("K")})` : 0, h.medianBasket, MONEY],
    ["Days covered", "", h.days, "#,##0"],
    ["Keells bills", "", h.keellsBills, "#,##0"],
    ["Keells net captured (Rs) — a floor, see note", "", h.keellsNet, MONEY],
  ];
  headRows.forEach(([label, f, result, fmt], i) => {
    const row = 5 + i;
    sum.getCell(row, 1).value = label;
    body(sum.getCell(row, 1), undefined, label.startsWith("Net paid"));
    const c = sum.getCell(row, 2);
    c.value = typeof f === "string" && f ? fx(f, result as number) : (result as number);
    body(c, fmt as string, label.startsWith("Net paid"));
  });
  let sr = 5 + headRows.length + 1;
  sum.getCell(sr, 1).value =
    "Keells totals are a floor, not a measurement: Keells prints a running points balance, and where that chain breaks a trip happened that is not in this ledger. The Capture Gap analysis arrives in a later release.";
  sum.getCell(sr, 1).font = { name: FONT, size: 10, bold: true, color: { argb: "FF7A4B00" } };
  sum.getCell(sr, 1).alignment = { wrapText: true, vertical: "top" };
  sum.mergeCells(sr, 1, sr, 4);
  sum.getRow(sr).height = 48;
  for (let c = 1; c <= 4; c++) sum.getCell(sr, c).fill = FLAG;

  const table = (
    label: string,
    key: string,
    rows: { key: string; bills: number; amount: number; share: number }[],
  ) => {
    sr += 2;
    band(sum, sr, label, 4);
    sr++;
    header(sum, sr, [key, "Bills", "Amount (Rs)", "Share"]);
    const first = ++sr;
    for (const x of rows) {
      sum.getCell(sr, 1).value = x.key;
      sum.getCell(sr, 2).value = x.bills;
      sum.getCell(sr, 3).value = x.amount;
      sum.getCell(sr, 4).value = x.share;
      [1, 2, 3, 4].forEach((c) => body(sum.getCell(sr, c), c === 3 ? MONEY : c === 4 ? PCT : undefined));
      sr++;
    }
    if (rows.length) {
      sum.getCell(sr, 1).value = "TOTAL";
      body(sum.getCell(sr, 1), undefined, true);
      const c = sum.getCell(sr, 3);
      c.value = {
        formula: `SUM(C${first}:C${sr - 1})`,
        result: round(rows.reduce((a, x) => a + x.amount, 0)),
      };
      body(c, MONEY, true);
    }
  };
  table("BY STORE (net)", "Store", byStore(sorted));
  table("BY PAYMENT METHOD (as printed on the bills)", "Method", byPayment(sorted));

  sr += 2;
  band(sum, sr, "HOW TO KEEP USING THIS WORKBOOK", 4);
  [
    "1. Keep this file — it is your ledger. Everything the app knows is inside it.",
    "2. Next time, open the app, go to Workbook, and import this file. Then add your new bills.",
    "3. Export again. The new file contains the old bills and the new ones. Repeat.",
    "4. Do not edit the Data_ sheets. Importing never overwrites a bill the ledger already has; a changed copy is reported, not applied.",
    "5. Add your own sheets, charts or formatting freely — only About and the Data_ sheets are read on import.",
  ].forEach((t) => {
    sr++;
    sum.getCell(sr, 1).value = t;
    body(sum.getCell(sr, 1));
  });
  widths(sum, [46, 18, 16, 12]);

  // ------------------------------------------------------------------ Line Items
  const li = wb.addWorksheet("Line Items");
  title(
    li,
    "All bill lines",
    "Category and subcategory columns arrive with the rules engine (Phase 2). Amounts are printed line amounts, before bill-level promotions.",
  );
  header(li, 3, [
    "Date",
    "Month",
    "Weekday",
    "Store",
    "Bill ref",
    "Source",
    "Line",
    "Item code",
    "Item",
    "Unit price (Rs)",
    "Qty",
    "Amount (Rs)",
    "Line discount (Rs)",
  ]);
  let lr = 4;
  for (const b of sorted) {
    b.items.forEach((i, k) => {
      const vals: (string | number | Date | null)[] = [
        dateCell(b.date),
        b.date.slice(0, 7),
        WEEKDAY.format(dateCell(b.date)),
        b.store,
        b.ref,
        b.source,
        i.line ?? k + 1,
        i.code,
        i.name,
        i.unitPrice,
        i.qty,
        i.amount,
        i.lineDiscount ?? null,
      ];
      vals.forEach((v, c) => {
        const cell = li.getCell(lr, c + 1);
        if (v !== null) cell.value = v;
        body(
          cell,
          c === 0
            ? "dd-mmm-yyyy"
            : c === 9 || c === 11 || c === 12
              ? MONEY
              : c === 10
                ? "#,##0.000"
                : undefined,
        );
      });
      lr++;
    });
  }
  const lLast = lr - 1;
  li.getCell(lr, 9).value = "TOTAL GROSS";
  body(li.getCell(lr, 9), undefined, true);
  const lt = li.getCell(lr, 12);
  lt.value =
    lLast >= 4
      ? {
          formula: `SUM(L4:L${lLast})`,
          result: round(sorted.reduce((a, b) => a + b.items.reduce((x, i) => x + i.amount, 0), 0)),
        }
      : 0;
  body(lt, MONEY, true);
  widths(li, [12, 9, 9, 18, 11, 9, 6, 11, 46, 14, 9, 14, 16]);
  li.views = [{ state: "frozen", ySplit: 3 }];
  if (lLast >= 4) li.autoFilter = { from: "A3", to: `M${lLast}` };

  // ------------------------------------------------------------------ Monthly Trend
  const mt = wb.addWorksheet("Monthly Trend");
  title(
    mt,
    "Month on month",
    "A part month is a few baskets, not a rate. Keells net is a floor (trips missing from the ledger are not counted).",
  );
  header(mt, 3, [
    "Month",
    "Bills",
    "Gross (Rs)",
    "Discount (Rs)",
    "Net (Rs)",
    "Discount %",
    "Avg basket (Rs)",
    "Keells net (Rs, floor)",
  ]);
  month.forEach((m, i) => {
    const row = 4 + i;
    mt.getCell(row, 1).value = m.month;
    const f = (col: number, formula: string, result: number, fmt?: string) => {
      mt.getCell(row, col).value = fx(formula, result);
      body(mt.getCell(row, col), fmt);
    };
    body(mt.getCell(row, 1));
    f(2, `COUNTIF(Bills!$B:$B,A${row})`, m.bills, "#,##0");
    f(3, `SUMIF(Bills!$B:$B,A${row},Bills!$I:$I)`, m.gross, MONEY);
    f(4, `SUMIF(Bills!$B:$B,A${row},Bills!$J:$J)`, m.discount, MONEY);
    f(5, `SUMIF(Bills!$B:$B,A${row},Bills!$K:$K)`, m.net, MONEY);
    f(6, `IFERROR(D${row}/C${row},0)`, m.discountRate, PCT);
    f(7, `IFERROR(E${row}/B${row},0)`, m.averageBasket, MONEY);
    f(8, `SUMIFS(Bills!$K:$K,Bills!$B:$B,A${row},Bills!$G:$G,"keells")`, m.keellsNet, MONEY);
  });
  widths(mt, [11, 8, 14, 14, 14, 11, 15, 20]);

  // ------------------------------------------------------------------ Sources & Method
  const sm = wb.addWorksheet("Sources & Method");
  title(sm, "Sources and method");
  const lines: [string, boolean][] = [
    ["SOURCE", true],
    [
      `Exported ${meta.exportedAt.toISOString()} from ${h.bills} bills by Grocery bill ledger v${meta.appVersion} (rules v${RULES_VERSION}).`,
      false,
    ],
    [
      "Every figure on Summary, Bills, Line Items and Monthly Trend is a sum of figures printed on a bill. Nothing is estimated.",
      false,
    ],
    ["", false],
    ["VALIDATION", true],
    [
      "Each bill was checked before it was saved: line items sum to gross, gross less discount equals net, tenders sum to net, promotion lines sum to the discount, and (Keells) points equal 0.34% of net. Tolerance Rs 0.02. The Checks column on Bills re-runs this at export.",
      false,
    ],
    ["", false],
    ["KNOWN LIMITS", true],
    [
      "Keells totals are a floor: trips missing from the ledger are not counted. The 0.34% points rate is derived, not printed on the bills.",
      false,
    ],
    [
      "Categories, discount-scheme models and the capture-gap analysis are not in this release; they will appear as extra sheets, and importing this file will keep working.",
      false,
    ],
    ["Receipt photos are not stored in the workbook.", false],
    ["", false],
    ["RE-IMPORT", true],
    [
      `Only the About sheet and the Data_ sheets are read on import (format ${WORKBOOK_FORMAT} v${WORKBOOK_VERSION}). Do not edit them by hand.`,
      false,
    ],
  ];
  lines.forEach(([t, bold], i) => {
    const c = sm.getCell(3 + i, 1);
    c.value = t;
    c.font = { name: FONT, size: 10, bold };
    c.alignment = { wrapText: true, vertical: "top" };
    if (bold) c.fill = BAND;
  });
  sm.getColumn(1).width = 120;

  // ------------------------------------------------------------------ About + Data sheets (read on import)
  const ab = wb.addWorksheet("About");
  const checksum = await ledgerChecksum(sorted);
  const aboutRows: [string, string | number][] = [
    ["Format", WORKBOOK_FORMAT],
    ["FormatVersion", WORKBOOK_VERSION],
    ["ExportedAt", meta.exportedAt.toISOString()],
    ["AppVersion", meta.appVersion],
    ["RulesVersion", RULES_VERSION],
    ["Bills", sorted.length],
    ["Checksum", checksum ?? ""],
  ];
  header(ab, 1, ["Key", "Value"], solid("FF595959"));
  aboutRows.forEach(([k, v], i) => {
    ab.getCell(2 + i, 1).value = k;
    ab.getCell(2 + i, 2).value = v;
    body(ab.getCell(2 + i, 1), undefined, true);
    body(ab.getCell(2 + i, 2));
  });
  ab.getCell(10, 1).value =
    "This sheet and the Data_ sheets are read when you import this workbook. Do not edit them; re-export from the app instead.";
  ab.getCell(10, 1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF595959" } };
  widths(ab, [18, 70]);
  ab.properties.tabColor = { argb: GREY };

  const data = billsToTables(sorted);
  for (const key of Object.keys(SHEET) as (keyof DataTables)[]) {
    const ws = wb.addWorksheet(SHEET[key]);
    ws.properties.tabColor = { argb: GREY };
    header(ws, 1, COLUMNS[key], solid("FF595959"));
    data[key].forEach((row, i) => {
      COLUMNS[key].forEach((col, c) => {
        const v = row[col];
        if (v !== null && v !== undefined) {
          const cell = ws.getCell(2 + i, c + 1);
          cell.value = v;
          cell.font = { name: FONT, size: 9 };
        }
      });
    });
    COLUMNS[key].forEach(
      (col, c) =>
        (ws.getColumn(c + 1).width = col === "text" ? 60 : col === "name" || col === "method" ? 36 : 14),
    );
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const out = await wb.xlsx.writeBuffer();
  return out as ArrayBuffer;
}

// ============================================================================================ reading

export interface ReadWorkbook {
  meta: WorkbookMeta;
  tables: DataTables;
}

/** A cell as plain data. Formulas and errors become the FORMULA marker so the reader refuses them. */
function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return FORMULA; // not a legitimate data value; refuse like a formula
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o || "error" in o) return FORMULA;
    if (Array.isArray(o.richText))
      return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (typeof o.text === "string") return o.text; // hyperlink
  }
  return FORMULA;
}

function readSheet(ws: Worksheet | undefined, required: readonly string[], cap: number, name: string): Row[] {
  if (!ws) return [];
  if (ws.rowCount > cap)
    throw new WorkbookError(
      `${name} has ${ws.rowCount - 1} rows — more than this app will read (${cap - 1})`,
    );
  const head = new Map<number, string>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, col) => {
    const v = plain(c.value);
    if (typeof v === "string" && v.trim()) head.set(col, v.trim());
  });
  const names = new Set(head.values());
  const missing = required.filter((r) => !names.has(r));
  if (missing.length) throw new WorkbookError(`${name} is missing the column(s): ${missing.join(", ")}`);
  const rows: Row[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const o: Row = {};
    let any = false;
    for (const [col, key] of head) {
      const v = plain(row.getCell(col).value);
      if (v !== null) any = true;
      o[key] = v;
    }
    if (any) rows.push(o);
  }
  return rows;
}

export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<ReadWorkbook> {
  const size = data.byteLength;
  if (size > MAX_WORKBOOK_BYTES) throw new WorkbookError("file is larger than 20 MB — refusing to read it");
  const head = new Uint8Array(
    data instanceof Uint8Array ? data.buffer : data,
    data instanceof Uint8Array ? data.byteOffset : 0,
    2,
  );
  if (head[0] !== 0x50 || head[1] !== 0x4b)
    throw new WorkbookError("not an .xlsx file (it is not a zip archive)");

  const wb = await newWorkbook();
  try {
    await wb.xlsx.load(data as ArrayBuffer);
  } catch {
    throw new WorkbookError("could not open this file as an .xlsx workbook — it may be corrupt");
  }

  const about = wb.getWorksheet("About");
  const kv = new Map<string, unknown>();
  about?.eachRow((row) => {
    const k = plain(row.getCell(1).value);
    if (typeof k === "string") kv.set(k, plain(row.getCell(2).value));
  });
  if (kv.get("Format") !== WORKBOOK_FORMAT) {
    throw new WorkbookError(
      "this workbook was not exported by Grocery bill ledger (no About sheet with the expected format) — only workbooks exported by this app can be imported",
    );
  }
  const version = Number(kv.get("FormatVersion"));
  if (!Number.isFinite(version) || version < 1)
    throw new WorkbookError("the workbook's format version is unreadable");
  if (version > WORKBOOK_VERSION)
    throw new WorkbookError(
      `this workbook is format v${version}, made by a newer version of the app — update the app to import it`,
    );

  const sheet = (key: keyof DataTables, req: readonly string[]) =>
    readSheet(wb.getWorksheet(SHEET[key]), req, MAX_ROWS[key], SHEET[key]);
  if (!wb.getWorksheet(SHEET.bills)) throw new WorkbookError(`the ${SHEET.bills} sheet is missing`);
  const tables: DataTables = {
    bills: sheet("bills", [
      "ref",
      "source",
      "date",
      "gross",
      "discount",
      "net",
      "itemCount",
      "tenderCount",
      "promotionCount",
    ]),
    items: sheet("items", ["ref", "seq", "code", "name", "unitPrice", "qty", "amount"]),
    tenders: sheet("tenders", ["ref", "seq", "method", "amount"]),
    promotions: sheet("promotions", ["ref", "seq", "amount"]),
    rawText: sheet("rawText", ["ref", "part", "text"]),
  };

  const s = (k: string) => (typeof kv.get(k) === "string" && kv.get(k) !== "" ? (kv.get(k) as string) : null);
  const n = (k: string) => (typeof kv.get(k) === "number" ? (kv.get(k) as number) : null);
  return {
    tables,
    meta: {
      exportedAt: s("ExportedAt"),
      appVersion: s("AppVersion"),
      rulesVersion: n("RulesVersion"),
      billsDeclared: n("Bills"),
      checksum: s("Checksum"),
    },
  };
}

export { WorkbookError };
