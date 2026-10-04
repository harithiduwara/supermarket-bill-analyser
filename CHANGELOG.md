# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

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
