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

**In scope:** Keells e-bill ingest; paper-receipt ingest by photo (OCR) with mandatory human confirmation;
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

- Given a link `…/FYQQRQ` and the page content, when I paste both, then the bill is parsed and the reference
  `FYQQRQ` is taken from the link.
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
| NFR-02 | Correctness     | The TS port reproduces the Python ledger on all 24 bills                                                                            | `seed.test`                                                                               |
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

## 7. Risks

| ID  | Risk                                                                     | L   | I   | Mitigation                                                                                  |
| --- | ------------------------------------------------------------------------ | --- | --- | ------------------------------------------------------------------------------------------- |
| R-1 | A misread OCR digit poisons every downstream figure                      | H   | H   | Mandatory confirmation, live line checks, save gated on checks, photo kept beside the table |
| R-2 | Browser storage cleared → ledger lost                                    | M   | H   | Persistent-storage request, backup reminder, export/import                                  |
| R-3 | Pasted digibill HTML differs from the saved text the parser was built on | M   | M   | Plain-text paste path; parse error is explicit; unverified status documented                |
| R-4 | Rules inferred from a few bills break on new data                        | H   | M   | Evidence + observation counts shown; seed bills are regression tests                        |
| R-5 | API key exposure on a shared machine                                     | M   | H   | Session-only by default, spend-limit advice, one-click clear                                |
| R-6 | Keells totals read as fact despite missing trips                         | H   | H   | Caveat attached to every Keells total                                                       |

## 8. Definition of Done

A story is done when: acceptance criteria pass as automated tests (IDs in test names); lint, typecheck,
coverage, audit and e2e (incl. axe) are green in CI; docs and changelog updated; no new dependency without an
entry in the PR description; reviewed by someone other than the author.
