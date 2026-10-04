# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Security

- **Removed real customer data** that shipped as starting data and test fixtures in the first public deploy
  (ADR-0007). Git history before this release still contains it until the owner agrees to a history rewrite.

### Changed

- The app now starts empty. **Load demo data** generates fake bills (US-26); they are marked as demo, removable, and
  never exported. Tests run on generated bills; a private parity test runs only with `REAL_FIXTURES_DIR`.
- Added `npm run check:privacy` (hashed-identifier guard) to `verify` and CI.

## [0.3.0] — 2026-10-04

The workbook loop: **add bills → export an Excel workbook → next time import it plus new bills → export again.**

### Added

- **Workbook page** (the new front door): import your last workbook, add new bills, export — with where things
  stand (bills in the ledger, bills not yet in a workbook you hold, last export).
- **Export to `.xlsx`** (US-22): Summary, Bills, Line Items, Monthly Trend, Sources & Method, plus the data sheets the
  importer reads. Totals are formulas that already carry their calculated values; Keells totals are marked a floor.
- **Import a workbook** (US-23): every bill schema-validated and re-reconciled; bills already present are skipped and
  never overwritten; a changed copy in the file is reported by reference; rejected bills are named with the failing
  check; several files at once; JSON backups still work. Reports contents-unchanged / edited-outside-the-app.
- **Lossless, repeatable round trip** (US-24): tested through three full export → import → export cycles.
- Safe by construction (NFR-13): `.xlsx` only (macro and legacy formats refused), 20 MB and row caps, formulas never
  evaluated, only the `About` and `Data_` sheets are read, so reformatting or extending the workbook in Excel is safe.
- ADR-0006, stories US-22–US-25, NFR-13/14, threat-model rows, and 52 more tests (184 unit, 80+ browser).

### Changed

- The app opens on the Workbook page; the ledger moved to its own route (`#/ledger`).
- JSON backup is now an advanced option under Settings; the workbook is the primary backup.
- `uuid` pinned to a patched CommonJS-compatible release (0 known vulnerabilities).

### Fixed

- A cached result of exactly 0 was dropped from exported formulas, which would show blank in viewers that do not
  recalculate; zeros are now written as plain numbers (and `fullCalcOnLoad` is set). A test checks every formula.
- Phone layout: a status sentence could not wrap and stretched the page; the tab bar was sized for five tabs.

## [0.2.0] — 2026-10-04

Phase 1 hardened to production standards. No analysis views yet (Phases 2–4 unchanged).

### Added

- **Requirements, ADRs and threat model** in `docs/`; a traceability gate that ties built stories and NFRs to tests.
- **Audit trail** (US-17): append-only events for added / duplicate / rejected / import / export / seed; _Activity_ page.
- **Bill detail page** with a stable link per bill: every check with its arithmetic, lines, promotions, tenders,
  the original e-bill text or receipt photo, and the bill's history.
- **Import hardening** (US-06): size cap, schema validation, every bill re-reconciled, per-bill reasons for rejects.
- **Backup reminder** (14 days after the first unexported change you made) and a request for persistent storage.
- **Receipt verification** beside the photo, sticky save bar, cancellable OCR with progress, drag-and-drop.
- **Phone layout** (US-19): bottom tab bar, bills as cards, collapsible filters, 44 px tap targets.
- **Accessibility** (US-20): WCAG 2.2 AA — skip link, focus management, labelled controls, text+icon status, dark mode.
- CSP and no-referrer policy; ESLint (incl. jsx-a11y), Prettier; coverage thresholds; bundle-size budget.
- 132 unit tests and 57 browser tests (golden paths, axe on every route in light and dark, 360 px, CSP).
- CI (lint, types, coverage, traceability, build, audit, e2e), CodeQL, Dependabot, PR/issue templates.

### Changed

- API key is held for the browser tab only by default; "remember on this device" is opt-in (NFR-05).
- OCR model output is treated as untrusted and coerced field by field; wrong types become "unreadable" blanks.
- Local database upgraded to schema v2 (additive; existing bills preserved — migration test).
- Toolchain: Vite 8, Vitest 5 (0 known vulnerabilities, dev dependencies included).

### Fixed

- `reconcile()` was ~25× slower than needed on large ledgers (per-call number formatter).
- Focus was stolen to the page heading on first load, putting the skip link out of tab order.

## [0.1.0] — 2026-10-04

First static release: ingest and reconcile Keells e-bills and photographed receipts; ledger seeded with the 24
real bills; verified against the original Python implementation.
