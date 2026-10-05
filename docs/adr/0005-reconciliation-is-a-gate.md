# ADR-0005: Reconciliation is a gate, not a warning

Status: accepted · Date: 2026-10-04

## Decision

A bill that fails any applicable check is not saved — from every path (e-bill, receipt, import). The tolerance
(Rs 0.02) is a named constant and is never widened. Missing printed values are failures, not defaults.

## Consequences

- One wrong digit cannot silently corrupt downstream figures. − A bill with a genuine parser gap is blocked
  until the parser or the transcription is fixed; the UI says which check failed and shows the arithmetic.
  Deliberate differences from the Python (missing values fail instead of defaulting) are listed in `parse.ts` and
  `receipt.ts`.
