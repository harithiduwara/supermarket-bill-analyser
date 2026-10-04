# Requirements — Grocery bill ledger

Status: living document · Owner: product · Last reviewed: 2026-10-04

## 1. Purpose and business goals

A household spends heavily at Keells Super and Softlogic Glomark. Neither gives a trustworthy running view of
what was spent, where, and what discount was left unclaimed. This product turns individual bills into a
**reconciled ledger** and derives analysis from it.

| ID   | Business goal                                                | Measure of success                                                              |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| BG-1 | Know what is really spent on groceries and on what           | Every figure shown can be traced to a bill that reconciled                      |
| BG-2 | Find discount left on the table (card choice, promo windows) | Opportunity view quantifies it as a ceiling, with overlaps named                |
| BG-3 | Trust the numbers                                            | Zero bills saved that fail reconciliation; every inference labelled as inferred |
| BG-4 | Be honest about what is missing                              | Every Keells total carries the capture-gap caveat                               |

## 2. Stakeholders and personas

- **P1 — Household bookkeeper (primary).** Captures bills from a phone (photo) and laptop (e-bill email/SMS
  links). Not technical. Wants to be told plainly when a bill does not add up, and why.
- **P2 — Reviewer.** A family member or accountant who reads an export and must be able to trace any figure
  back to a bill. Never edits.

## 3. Scope

**In scope:** the workbook loop (export / import Excel); Keells e-bill ingest; paper-receipt ingest by photo (OCR) with mandatory human confirmation;
reconciliation; idempotent ledger; derived analysis (9 views); backup/restore; XLSX export; accessibility.

**Out of scope (and why it matters for the architecture):**

- Authentication, multi-user, roles, SSO, server-side storage, multi-device sync, email ingestion.
  These need a backend. The product is deliberately a static, browser-only app (ADR-0001), so they are
  **Won't (this release)**, not omitted by accident. The migration path is recorded in ADR-0001.
- Budgets, alerts, a mobile app.

## 4. Assumptions, constraints, dependencies

- A1. The 24 seed bills are representative. Rules inferred from them are labelled _inferred_ and carry the
  number of observations behind them.
- A2. The digibill host does not allow cross-origin reads, so e-bill content is pasted, not fetched (ADR-0002).
- C1. Hosting is GitHub Pages: static files only.
- C2. Photo OCR calls the Anthropic API from the browser with the user's own key (ADR-0004).
- D1. Browser support: current and previous major versions of Chrome, Edge, Firefox, Safari (IndexedDB, `fetch`,
  CSS grid).

## 5. User stories

Priority is MoSCoW. Phase is the delivery phase. Status: ✅ built · 🔨 this release · ⏳ planned · ⛔ won't.
**Acceptance criteria are testable; each Must has at least one automated test whose name carries the story ID**
(enforced by `npm run check:traceability`).

### Ingest and integrity

**US-01 Add a Keells e-bill** — Must · P1 · ✅
As P1, I paste a digibill link and the page content so that the bill is added to the ledger.

- Given a link `…/AB12CD` and the page content, when I paste both, then the bill is parsed and the reference
  `AB12CD` is taken from the link.
- Given either summary layout (bullet list or wide table row), then the totals parse identically.
- Given the page has no Gross or Net line, then parsing fails with a message; nothing is defaulted to 0.

**US-02 Add a photo receipt with confirmation** — Must · P1 · ✅
As P1, I photograph a receipt and confirm what was read before anything is saved.

- Given one or more photos, when read, then lines appear in an editable table beside the photo.
- Given any blank or unreadable figure, then it is shown as blank and is a blocking problem — never a zero.
- Given two overlapping photos, then lines are de-duplicated on line number, and a disagreement between the
  photos on a line is reported, not hidden.
- Given any line where rate × qty − discount ≠ amount, then that row is marked and Save is disabled.

**US-03 Idempotent ingest** — Must · P1 · ✅

- Given a bill reference already in the ledger, when it is submitted again, then nothing changes and I am told
  it was already present — even if the content differs.
- Given an overlapping batch, then only the new bills are added.

**US-04 Reconciliation blocks the save** — Must · P1 · ✅

- Given a bill, then five checks run: items = gross; gross − discount = net; tenders = net; promotion lines =
  discount; points = 0.34% of net (Keells only). Photo receipts also check every line.
- Given any applicable check fails, then the bill is not saved, the failing check is named with its arithmetic,
  and the tolerance (Rs 0.02) is not widened.

**US-05 Browse the ledger** — Must · P1/P2 · 🔨

- Given the ledger, then I can search, filter by source and month, sort, and open any bill by a stable link.
- Given a bill, then I see every check result with its arithmetic, the lines, tenders, promotions, the original
  e-bill text or receipt photo, and the audit events for that bill.
- Given a very large ledger, then the list stays responsive (paged rendering).

**US-06 Backup and restore** — Must · P1 · ✅/🔨

- Given the ledger, then I can export it to a file and import it back.
- Given an import, then every bill goes through the same reconciliation; bills already present are skipped;
  a malformed or hostile file is rejected with a reason and changes nothing.
- Given the ledger has changes not yet exported for 14 days, then I am reminded (non-blocking).
- Given the browser supports it, then persistent storage is requested so the ledger is not evicted.

### The workbook loop (the core workflow)

The Excel workbook is the ledger's portable carrier between sessions (ADR-0006): **add bills → export a workbook →
next time, import that workbook plus new bills → export again → repeat.**

**US-22 Export a workbook** — Must · P1 · 🔨
As P1, I download one Excel file containing everything, so that I can keep it, open it in Excel and use it next time.

- Given a ledger, when I export, then I get an `.xlsx` with readable sheets (Summary, Bills, Line Items, Monthly
  Trend, Sources & Method) and data sheets the importer reads (`Data_*`, `About`).
- Given the totals rows, then they are Excel formulas that already carry their calculated values (no blank cells
  before Excel recalculates).
- Given the Keells totals, then the workbook carries the capture-gap caveat, as the app does.
- Given I never typed a figure, then every figure in the workbook is exactly as printed on a bill.

**US-23 Import a workbook and keep going** — Must · P1 · 🔨
As P1, I import my previously exported workbook, then add new bills, so that I never start from nothing.

- Given a workbook exported by this app, when I import it, then every bill is schema-validated and re-reconciled;
  bills already in the ledger are skipped; new ones are added; bills failing a check are rejected **by name with
  the failing check**.
- Given several workbooks (or JSON backups) at once, then they are merged in order, idempotently.
- Given a bill in the file whose content differs from the copy already in the ledger, then the ledger copy is kept
  and the difference is **reported by reference** (the ledger is the source of truth; nothing is silently overwritten).
- Given a file not exported by this app, a newer format, a macro-enabled or legacy format, an oversized file, or a
  corrupt file, then it is rejected with a plain reason and the ledger is unchanged.
- Given the data sheets no longer match the checksum written at export, then I am told the file was edited outside
  the app (the bills are still individually re-reconciled).
- Given formulas in data cells, then they are never evaluated; the cell is treated as invalid.

**US-24 Lossless, repeatable round trip** — Must · P1 · 🔨

- Given any ledger, when I export, import into an empty ledger, and export again — any number of times — then the
  bills are identical (including printed totals, tenders, promotions, line numbers, null vs zero, original e-bill text).
- Given I import the same workbook twice, then nothing changes the second time.

**US-25 Guided workbook page** — Should · P1 · 🔨

- Given the app opens, then the first screen shows the three steps (import → add bills → export) with the current
  state: bills in the ledger, bills added since the last export, last export time.
- Given bills were added since the last export, then I am told plainly that the workbook on disk is out of date.

**US-26 Demo data is clearly fake, removable, and never exported** — Must · P1 · 🔨

- Given a new visitor, then the ledger is empty and a "Load demo data" action offers generated sample bills.
- Given demo bills are loaded, then every screen marks them as demo, and I can remove exactly those (my own bills stay).
- Given I export a workbook or a JSON backup, then demo bills are never included.
- Given the repository or the built bundle, then it contains no real customer data (ADR-0007; `npm run check:privacy`).

**US-17 Audit trail** — Should · P2 · 🔨

- Given any ingest, import, export or seed, then an append-only event is recorded with time, type, reference,
  and for rejections the failing checks.
- Given the Activity page, then I can read the events newest first.

**US-16 Correct or void a bill** — Should · P1 · ⏳
Void with a reason (soft delete, audited, restorable). Not built: needs a decision on how a voided reference
interacts with US-03.

### Analysis (Phases 2–4)

**US-07 Categories and subcategories** — Must · Phase 2 · ⏳ 13 categories, 57 subcategories, reconcile
exactly to the same total; no item falls to an "Other" bucket (a failing test, not a warning).
**US-08 Scheme model** — Must · Phase 2 · ⏳ Four promotions; each reproduces its source bill to the cent;
the cap truncates one line; line discounts round up.
**US-09 Capture gap** — Must · Phase 3 · ⏳ Points-chain breaks → implied missing spend; gaps above ~Rs 30,000
are credits, not spend. Every Keells total carries this caveat.
**US-10 Monthly trend** · **US-11 Price watch** · **US-12 Replenishment** · **US-13 Daily cost** ·
**US-14 Opportunity** — Must/Should · Phase 3 · ⏳ Each shows its caveats on screen.
**US-15 XLSX export** — Should · Phase 4 · ⏳ Reproduces the existing workbook's sheets.

### Experience and quality

**US-19 Capture on a phone** — Must · P1 · 🔨 The photo flow works one-handed at 360 px width; no horizontal
page scroll; tap targets ≥ 44 px.
**US-20 Accessible** — Must · P1 · 🔨 WCAG 2.2 AA: keyboard-only operation, visible focus, labelled controls,
status not conveyed by colour alone, announced results, no contrast failures, reduced-motion respected.
**US-21 Multi-device sync, multiple users, SSO** — Won't (this release) · ⛔ See ADR-0001.

## 6. Non-functional requirements

| ID     | Category        | Requirement                                                                                                                         | Verified by                                                                               |
| ------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| NFR-01 | Correctness     | Reconciliation tolerance is 0.02 and is never widened                                                                               | unit tests (`reconcile.test`)                                                             |
| NFR-02 | Correctness     | The TS port reproduces the Python rules (synthetic round-trip tests; optional private parity run, ADR-0007)                         | `seed.test`                                                                               |
| NFR-03 | Integrity       | Nothing derived is stored; imports and OCR output are validated as untrusted input                                                  | `audit.test` (import), `ocr.test` (OCR output)                                            |
| NFR-04 | Security        | CSP restricts scripts to self and network to api.anthropic.com                                                                      | e2e (no CSP violations)                                                                   |
| NFR-05 | Security        | API key is held for the browser tab only by default; persisting it is opt-in and revocable                                          | `settings.test`, e2e `settings.spec`                                                      |
| NFR-06 | Privacy         | Bills never leave the device; the app makes no third-party requests; only receipt photos go to the OCR provider, on explicit action | e2e `security.spec` (no third-party requests)                                             |
| NFR-07 | Accessibility   | Zero axe violations on every route (WCAG 2.2 AA tags)                                                                               | e2e `a11y.spec`                                                                           |
| NFR-08 | Performance     | 5,000-bill ledger lists in < 1 s (paged); main JS bundle ≤ 120 kB gzip                                                              | `ledgerView.test` (query time); CI bundle-size gate (not a test title)                    |
| NFR-09 | Maintainability | Lint and formatting clean; domain coverage ≥ 90% lines                                                                              | CI: lint, prettier, coverage thresholds (not a test title)                                |
| NFR-10 | Supply chain    | Dependency audit (high+) and CodeQL run on every push; Dependabot weekly                                                            | CI: audit, CodeQL, Dependabot (not a test title)                                          |
| NFR-11 | Resilience      | Schema upgrades of the local DB preserve existing bills                                                                             | `migration.test`                                                                          |
| NFR-12 | Honesty         | Every Keells total carries the capture-gap caveat; every inferred rule states its evidence and observation count                    | e2e `ledger.spec` (caveat on every Keells total); review checklist for rules from Phase 2 |
| NFR-13 | Security        | Workbook import is bounded and inert: size and row caps, `.xlsx` only, formulas never evaluated, unknown sheets ignored             | `xlsx.test`, `workbook.test`                                                              |
| NFR-14 | Integrity       | Export → import → export is lossless and repeatable                                                                                 | `xlsx.test`, `workbook.test`, e2e `workbook.spec`                                         |

## 7. Risks

| ID  | Risk                                                                     | L   | I   | Mitigation                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------ | --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | A misread OCR digit poisons every downstream figure                      | H   | H   | Mandatory confirmation, live line checks, save gated on checks, photo kept beside the table                                                                                       |
| R-2 | Browser storage cleared → ledger lost                                    | M   | H   | Persistent-storage request, backup reminder, export/import                                                                                                                        |
| R-3 | Pasted digibill HTML differs from the saved text the parser was built on | M   | M   | Plain-text paste path; parse error is explicit; unverified status documented                                                                                                      |
| R-4 | Rules inferred from a few bills break on new data                        | H   | M   | Evidence + observation counts shown; seed bills are regression tests                                                                                                              |
| R-5 | API key exposure on a shared machine                                     | M   | H   | Session-only by default, spend-limit advice, one-click clear                                                                                                                      |
| R-7 | A user edits a bill in Excel and expects the app to pick it up           | M   | M   | Ledger is the source of truth: edited existing bills are kept as-is and the difference is reported by reference; checksum flags outside edits; Data sheets labelled "do not edit" |
| R-8 | A hostile or corrupt `.xlsx` (zip bomb, formulas, huge sheets)           | L   | M   | Size cap, row caps, `.xlsx` only, formulas never evaluated, lazy-loaded reader, per-bill validation + reconcile                                                                   |
| R-6 | Keells totals read as fact despite missing trips                         | H   | H   | Caveat attached to every Keells total                                                                                                                                             |

## 8. Definition of Done

A story is done when: acceptance criteria pass as automated tests (IDs in test names); lint, typecheck,
coverage, audit and e2e (incl. axe) are green in CI; docs and changelog updated; no new dependency without an
entry in the PR description; reviewed by someone other than the author.
