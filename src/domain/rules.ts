/** Rules module — everything inferred rather than printed on a bill lives here.
 *
 * Phase 1 holds the constants the ingest path needs. Phase 2 adds the category,
 * subcategory and scheme rules to THIS file, with the evidence for each ordering.
 *
 * RULES_VERSION: bump when any rule changes; every view is derived on read, so a
 * bump re-splits the whole history.
 */
export const RULES_VERSION = 1;

/** Points per rupee of net on Keells. Derived, not printed; exact on all 21
 * Keells bills seen. Keells only — Glomark/Softlogic points follow no flat rate
 * (0.39%, 0.33%, 0.46% on three bills), so never derive a Softlogic figure. */
export const POINTS_RATE = 0.0034;

/** Reconciliation tolerance, in rupees. Do not widen to make a bill pass. */
export const TOLERANCE = 0.02;

/** A new Keells store code passes through as the raw code; add it here. */
export const STORE_NAMES: Record<string, string> = {
  SCK3: "Kottawa",
  SCME: "Mattegoda",
  SIAL: "Aluthgama",
};
