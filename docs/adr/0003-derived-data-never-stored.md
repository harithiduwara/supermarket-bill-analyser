# ADR-0003: The ledger stores facts; everything else is derived on read

Status: accepted · Date: 2026-10-04

## Decision

Only printed or transcribed fields are stored. Category, subcategory, weekday, scheme eligibility and every
analysis are computed from the ledger on read, using a versioned rules module (`RULES_VERSION`).

## Consequences

- A rule change re-splits the whole history with no migration, and a stored figure can never drift from its source.
  − Every view recomputes; acceptable at this scale (NFR-08 asserts it).
  The original Python stored category fields in its ledger; the port deliberately drops them and a test compares
  recomputed values against the Python's stored ones.
