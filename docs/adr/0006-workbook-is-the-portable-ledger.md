# ADR-0006: The Excel workbook is the portable ledger

Status: accepted · Date: 2026-10-04

## Context

With no server (ADR-0001) the ledger lives in one browser. The user's actual workflow — inherited from the
original Python tool — is: capture bills, produce a workbook, and next time start from that workbook plus the new
bills. The original kept `ledger.json` as the durable artefact and rebuilt the workbook from it; here the workbook
itself must be the thing the user keeps.

## Decision

The export is one `.xlsx` with two layers:

1. **Readable sheets** (Summary, Bills, Line Items, Monthly Trend, Sources & Method; analysis sheets arrive with
   Phases 2–3). Regenerated on every export. Totals are formulas that also carry calculated values.
2. **Data sheets** (`Data_Bills`, `Data_Items`, `Data_Tenders`, `Data_Promotions`, `Data_RawText`, `About`):
   a normalised, lossless copy of the ledger. **Only these are read on import.** Readable sheets are never parsed.

Import goes through the same path as every other input: schema validation → `reconcile()` gate → idempotent
insert keyed on `ref` (ADR-0005). Rules:

- A reference already in the ledger is never overwritten. If the file's copy differs, the difference is reported.
- `About` carries a format version and a SHA-256 over the canonical bills; a mismatch means "edited outside the
  app" and is reported, not trusted or rejected (each bill is still individually reconciled).
- Formulas in data cells are never evaluated.

## Consequences

- The user's file is the backup, the report and the hand-over; export → import → export is lossless.
- No parsing of presentation sheets, so reformatting or adding charts in Excel does not break import.
  − Editing an existing bill in Excel has no effect (reported); correcting a bill needs the void/correct feature (US-16).
  − The `.xlsx` reader/writer (ExcelJS) is ~250 kB gzip; it is loaded only when exporting or importing.
  − Receipt photos are not in the workbook (size); they stay in the browser.
