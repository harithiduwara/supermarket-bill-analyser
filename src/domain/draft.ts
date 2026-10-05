/** The editable receipt form's model. Fields are strings because that is what
 * the user types; anything blank or non-numeric is a PROBLEM, never defaulted
 * to 0 (design rule 4). A draft only becomes a Bill when it has no problems,
 * and only saves when that Bill also passes every reconciliation check.
 */
import type { OcrDraft } from "./ocr";
import { buildReceipt, type ReceiptInput } from "./receipt";
import { reconcile, allPass } from "./reconcile";
import type { Bill, CheckResult } from "./types";

export interface DraftLine {
  ln: string;
  code: string;
  name: string;
  rate: string;
  qty: string;
  discount: string;
  amount: string;
  scheme: string;
}
export interface DraftTender {
  method: string;
  amount: string;
}
export interface ReceiptDraft {
  prefix: string;
  ticket: string;
  store: string;
  storeCode: string;
  date: string;
  time: string;
  printedGross: string;
  printedDiscount: string;
  printedNet: string;
  pointsEarned: string;
  pointsBalance: string;
  loyaltyScheme: string;
  tenders: DraftTender[];
  lines: DraftLine[];
}

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export const blankLine = (n: number): DraftLine => ({
  ln: String(n),
  code: "",
  name: "",
  rate: "",
  qty: "",
  discount: "0",
  amount: "",
  scheme: "",
});

export const blankDraft = (): ReceiptDraft => ({
  prefix: "GLO",
  ticket: "",
  store: "",
  storeCode: "",
  date: "",
  time: "",
  printedGross: "",
  printedDiscount: "",
  printedNet: "",
  pointsEarned: "",
  pointsBalance: "",
  loyaltyScheme: "",
  tenders: [{ method: "", amount: "" }],
  lines: [],
});

export function fromOcr(o: OcrDraft, prefix = "GLO"): ReceiptDraft {
  return {
    prefix,
    ticket: s(o.ticket),
    store: s(o.store),
    storeCode: s(o.storeCode),
    date: s(o.date),
    time: s(o.time),
    printedGross: s(o.printedGross),
    printedDiscount: s(o.printedDiscount),
    printedNet: s(o.printedNet),
    pointsEarned: s(o.pointsEarned),
    pointsBalance: s(o.pointsBalance),
    loyaltyScheme: s(o.loyaltyScheme),
    tenders: o.tenders.length
      ? o.tenders.map((t) => ({ method: t.method, amount: s(t.amount) }))
      : [{ method: "", amount: "" }],
    lines: o.lines.map((l, i) => ({
      ln: s(l.ln ?? i + 1),
      code: s(l.code),
      name: s(l.name),
      rate: s(l.rate),
      qty: s(l.qty),
      discount: l.discount === null ? "" : s(l.discount),
      amount: s(l.amount),
      scheme: s(l.scheme),
    })),
  };
}

/** blank / unparseable -> null. Accepts thousands separators. */
export const parseNum = (v: string): number | null => {
  const t = v.replace(/,/g, "").trim();
  if (t === "" || !/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
};

export interface LineStatus {
  ok: boolean;
  message: string;
}

/** Live per-line check: rate × qty − discount = amount. */
export function lineStatus(l: DraftLine): LineStatus {
  const rate = parseNum(l.rate),
    qty = parseNum(l.qty),
    disc = parseNum(l.discount),
    amt = parseNum(l.amount);
  if (rate === null || qty === null || disc === null || amt === null)
    return { ok: false, message: "a figure is blank or unreadable" };
  const calc = Math.round((rate * qty - Math.abs(disc)) * 100) / 100;
  const ok = Math.abs(calc - amt) <= 0.02;
  return {
    ok,
    message: ok
      ? ""
      : `${rate} × ${qty} − ${Math.abs(disc)} = ${calc.toFixed(2)}, receipt says ${amt.toFixed(2)}`,
  };
}

export interface DraftOutcome {
  problems: string[];
  bill: Bill | null;
  checks: CheckResult[];
  canSave: boolean;
}

export function evaluate(d: ReceiptDraft): DraftOutcome {
  const problems: string[] = [];
  const need = (label: string, v: string) => {
    if (!v.trim()) problems.push(`${label} is blank`);
  };
  need("Ticket number", d.ticket);
  need("Store", d.store);
  need("Date", d.date);
  need("Time", d.time);
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) problems.push("Date must be YYYY-MM-DD");
  if (d.time && !/^\d{2}:\d{2}$/.test(d.time)) problems.push("Time must be HH:MM");
  const gross = parseNum(d.printedGross),
    disc = parseNum(d.printedDiscount),
    net = parseNum(d.printedNet);
  if (gross === null) problems.push("Printed gross is blank or unreadable");
  if (disc === null)
    problems.push("Printed discount is blank or unreadable (enter 0 only if the receipt prints 0)");
  if (net === null) problems.push("Printed net is blank or unreadable");
  const pe = d.pointsEarned.trim() === "" ? null : parseNum(d.pointsEarned);
  const pb = d.pointsBalance.trim() === "" ? null : parseNum(d.pointsBalance);
  if (d.pointsEarned.trim() !== "" && pe === null) problems.push("Points earned is not a number");
  if (d.pointsBalance.trim() !== "" && pb === null) problems.push("Points balance is not a number");
  if (!d.lines.length) problems.push("No line items");

  const lines: ReceiptInput["lines"] = [];
  d.lines.forEach((l, i) => {
    const n = i + 1;
    const rate = parseNum(l.rate),
      qty = parseNum(l.qty),
      amt = parseNum(l.amount),
      dsc = parseNum(l.discount);
    if (!l.code.trim() || !l.name.trim()) problems.push(`Line ${n}: code or name is blank`);
    if (rate === null || qty === null || amt === null || dsc === null) {
      problems.push(`Line ${n}: rate, qty, discount or amount is blank or unreadable`);
      return;
    }
    const ln = parseNum(l.ln);
    lines.push({
      ln: ln ?? n,
      code: l.code.trim(),
      name: l.name.trim(),
      rate,
      qty,
      discount: dsc,
      amount: amt,
      scheme: l.scheme.trim() || null,
    });
  });
  const lnSeen = new Set<number>();
  for (const l of lines) {
    if (lnSeen.has(l.ln as number)) problems.push(`Line number ${l.ln} appears twice`);
    lnSeen.add(l.ln as number);
  }

  const tenders = d.tenders.filter((t) => t.method.trim() || t.amount.trim());
  const tParsed = tenders.map((t) => ({ method: t.method.trim(), amount: parseNum(t.amount) }));
  if (!tParsed.length) problems.push("No tender line");
  if (tParsed.some((t) => !t.method || t.amount === null))
    problems.push("A tender line has a blank method or amount");

  if (problems.length) return { problems, bill: null, checks: [], canSave: false };
  const bill = buildReceipt({
    ref: `${d.prefix.trim().toUpperCase()}${d.ticket.trim()}`,
    source: d.prefix.trim().toLowerCase() === "glo" ? "glomark" : "other",
    store: d.store.trim(),
    storeCode: d.storeCode.trim(),
    date: d.date,
    time: d.time,
    pointsEarned: pe,
    pointsBalancePrinted: pb,
    loyaltyScheme: d.loyaltyScheme.trim() || null,
    printed: { gross: gross as number, discount: disc as number, net: net as number },
    tenders: tParsed as { method: string; amount: number }[],
    lines,
    transcribedFrom: "photograph (confirmed by user)",
  });
  const checks = reconcile(bill);
  return { problems, bill, checks, canSave: allPass(checks) };
}
