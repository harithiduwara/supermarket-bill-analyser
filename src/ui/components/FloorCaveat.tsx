/** Every Keells total must carry this (BG-4, R-6): the ledger understates real Keells spend. */
export function FloorCaveat({ compact = false }: { compact?: boolean }) {
  return (
    <div className="banner warn" role="note">
      <strong>Keells totals are a floor, not a measurement.</strong>
      {!compact && (
        <>
          {" "}
          Keells prints a running points balance; where that chain breaks, a trip happened that is not in this
          ledger.
        </>
      )}
      <details>
        <summary>Why, and how big?</summary>
        <p className="small">
          {compact &&
            "Keells prints a running points balance; where that chain breaks, a trip happened that is not in this ledger. "}
          In the starting data about 35% of Keells spend is missing this way. The Capture Gap view that
          quantifies it for your ledger arrives in Phase 3; until then read every Keells figure as
          understated. Glomark has no equivalent check, because its points follow no flat rate.
        </p>
      </details>
    </div>
  );
}
