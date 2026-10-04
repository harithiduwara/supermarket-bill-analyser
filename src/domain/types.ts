/** Canonical bill record. Both input paths (e-bill text, photo receipt) produce this.
 *
 * Only transcribed / printed facts are stored. Category, subcategory, weekday,
 * fresh-eligibility and the reconciliation result are DERIVED and recomputed on
 * read (design rule 1) — the Python ledger stored them; this one deliberately
 * does not, so a rule change re-splits the whole history without a migration.
 */
export type Source = "keells" | "glomark" | string;

export interface BillItem {
  /** receipt line number — the reliable key for de-duplicating overlapping photos */
  line?: number;
  code: string;
  name: string;
  unitPrice: number;
  qty: number;
  /** gross line amount: Keells prints it; for receipts it is rate x qty */
  amount: number;
  /** photo receipts only: discount printed on the line, positive */
  lineDiscount?: number;
  /** photo receipts only: post-discount amount as printed on the receipt */
  netAmount?: number;
}

export interface Tender {
  method: string;
  amount: number;
}

export interface Promotion {
  scheme: string | null;
  line: number | null;
  code: string | null;
  pct: number | null;
  amount: number;
}

export interface Bill {
  ref: string;
  source: Source;
  store: string;
  storeCode: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  /** the three totals AS PRINTED on the bill — never recomputed into place */
  gross: number;
  discount: number;
  net: number;
  /** null = the bill did not print it. Never defaulted to 0. */
  pointsEarned: number | null;
  pointsBalancePrinted: number | null;
  loyaltyScheme?: string | null;
  tenders: Tender[];
  promotions: Promotion[];
  items: BillItem[];
  /** synthetic bill from the built-in demo set — never exported, removable in one action */
  demo?: boolean;
  /** fetched e-bill text, kept because the digibill link expires (~3 months) */
  rawText?: string;
  transcribedFrom?: string;
  notes?: string;
}

export type CheckId =
  | "itemsEqualGross"
  | "grossLessDiscountEqualsNet"
  | "tendersEqualNet"
  | "promoLinesEqualDiscount"
  | "pointsMatchRate"
  | "lineArithmetic";

export interface CheckResult {
  id: CheckId;
  label: string;
  /** false = does not apply to this bill (e.g. points check on Glomark) */
  applicable: boolean;
  ok: boolean;
  /** the arithmetic, shown to the user when it fails */
  detail: string;
}

export interface IngestResult {
  status: "added" | "duplicate" | "rejected";
  ref: string;
  checks: CheckResult[];
}

export type AuditType = "added" | "duplicate" | "rejected" | "import" | "export" | "seed" | "removed";
export type InputPath = "ebill" | "receipt" | "import" | "seed";

/** Append-only record of what happened to the ledger (US-17). Informational: the
 * ledger is local, so this is a diary, not tamper-proof evidence (see threat model). */
export interface AuditEvent {
  id?: number;
  at: string; // ISO timestamp
  type: AuditType;
  ref?: string;
  via?: InputPath;
  detail?: string;
}
