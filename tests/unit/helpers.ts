/** Shared unit-test data. Everything is SYNTHETIC (src/domain/demo.ts): no real customer data may be used in tests
 * (scripts/check-privacy.mjs enforces it). */
import { demoBills, DEMO_REFS } from "../../src/domain/demo";
import { ingestMany } from "../../src/domain/ingest";
import type { LedgerStore } from "../../src/domain/store";
import type { Bill } from "../../src/domain/types";
import type { ReceiptDraft } from "../../src/domain/draft";

/** Named bills with the features the tests rely on. */
export const REF = {
  /** Keells, bullets layout, two tenders (RewadzPay), line deals, NTB fresh promotion, raw text */
  rich: DEMO_REFS.rich,
  /** another ordinary Keells bill */
  other: "DEM005",
  /** Keells, no discount, wide-table layout */
  simple: DEMO_REFS.plain,
  /** Glomark receipt on the capped Sampath scheme: many lines, one truncated */
  glomark: DEMO_REFS.glomarkSampath,
} as const;

/** The 24 demo bills (21 Keells e-bills, 3 Glomark receipts), not flagged `demo` so they export like real ones. */
export const allSeed = (): Bill[] => demoBills();

export const seedBill = (ref: string): Bill => {
  const b = allSeed().find((x) => x.ref === ref);
  if (!b) throw new Error(`no demo bill ${ref}`);
  return structuredClone(b);
};

/** The rendered text of a Keells demo bill, as the e-bill page would read. */
export const rawText = (ref: string): string => {
  const t = seedBill(ref).rawText;
  if (!t) throw new Error(`${ref} has no e-bill text`);
  return t;
};
export const rawRefs = (): string[] =>
  allSeed()
    .filter((b) => b.source === "keells")
    .map((b) => b.ref);
export const glomarkRefs = (): string[] =>
  allSeed()
    .filter((b) => b.source === "glomark")
    .map((b) => b.ref);

/** Load bills into a store the way the app loads the demo set, with one summary event. */
export async function seedLedger(store: LedgerStore, bills: Bill[]) {
  const results = await ingestMany(store, bills, { via: "seed", silent: true });
  const added = results.filter((r) => r.status === "added").length;
  await store.log({ type: "seed", via: "seed", detail: `${added} of ${bills.length} seed bills loaded` });
  return results;
}

/** What a user would have typed into the receipt form for a Glomark bill. */
export function draftFromBill(b: Bill): ReceiptDraft {
  return {
    prefix: "GLO",
    ticket: b.ref.replace("GLO", ""),
    store: b.store,
    storeCode: b.storeCode,
    date: b.date,
    time: b.time,
    printedGross: String(b.gross),
    printedDiscount: String(b.discount),
    printedNet: String(b.net),
    pointsEarned: String(b.pointsEarned ?? ""),
    pointsBalance: String(b.pointsBalancePrinted ?? ""),
    loyaltyScheme: b.loyaltyScheme ?? "",
    tenders: b.tenders.map((t) => ({ method: t.method, amount: String(t.amount) })),
    lines: b.items.map((i, k) => ({
      ln: String(i.line ?? k + 1),
      code: i.code,
      name: i.name,
      rate: String(i.unitPrice),
      qty: String(i.qty),
      discount: String(i.lineDiscount ?? 0),
      amount: String(i.netAmount),
      scheme: "",
    })),
  };
}

/** `2026-06-07` -> `07-Jun-2026`, as printed on an e-bill. */
export const ebillDate = (ymd: string): string => {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${ymd.slice(8, 10)}-${m[+ymd.slice(5, 7) - 1]}-${ymd.slice(0, 4)}`;
};
