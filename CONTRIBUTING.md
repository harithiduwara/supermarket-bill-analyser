# Contributing

This is a financial-data tool: the rule is **a number is only shown if it can be traced to a bill that
reconciled**. Everything below serves that.

## Workflow (SDLC)

1. **Requirement first.** Work starts from a user story in [`docs/requirements.md`](docs/requirements.md)
   (or a new one added there, with Given/When/Then criteria and a MoSCoW priority). No story, no feature.
2. **Decision records.** If you change how something fundamental works (storage, hosting, trust boundaries,
   how reconciliation behaves), add or supersede an ADR in `docs/adr/`.
3. **Branch** from `main`: `feat/US-xx-short-name`, `fix/…`, `docs/…`. Small, reviewable PRs.
4. **Test first or alongside.** Put the story/NFR ID in the test title (`US-04 …`). `npm run check:traceability`
   fails if a built Must/Should story or a test-verified NFR is not named in any test.
5. **Verify locally** before pushing:
   ```
   npm run verify      # lint, prettier, types, unit tests + coverage, traceability, build, bundle budget
   npm run build && npm run test:e2e   # browser tests incl. axe accessibility on every route
   ```
6. **Pull request** using the template. CI runs the same gates plus `npm audit`, CodeQL and the e2e suite.
   Deploys to GitHub Pages happen only from `main`, only after CI is green.
7. **Review.** Changes under `src/domain/` and `docs/` require the code owner. Authors do not self-approve.
8. **Changelog.** User-visible changes go in `CHANGELOG.md` (Keep a Changelog; Semantic Versioning).

Suggested branch protection on `main` (a repository setting — not enforceable from code): require a PR, require
the `quality` and `e2e` checks, require code-owner review, disallow force-push.

## Commits

Conventional style: `feat(US-05): bill detail page`, `fix(reconcile): …`, `docs(adr): …`, `test: …`.

## Non-negotiables (these have each been a real bug somewhere)

- **Never invent a figure.** No defaults, interpolation or "approximately". Missing → fail loudly.
- **Never widen the tolerance** (`TOLERANCE` in `src/domain/rules.ts`) to make a bill pass.
- **A failed check blocks the save**, from every path (e-bill, receipt, import).
- **Derived data is never stored.** Compute it on read from the ledger.
- **Rules live in `src/domain/rules.ts`**, with the evidence and observation count for each, and the reason
  for any ordering. Port regexes verbatim; a tidy-up refactor silently breaks them.
- **Every inferred conclusion says it is inferred.** Keep caveats ("one observation", "a ceiling not a target",
  "treat as a hypothesis") when porting analysis.
- **Untrusted input is validated:** imported files, OCR output, pasted pages.
- **No third-party scripts, fonts or CDNs.** The CSP forbids them and a test fails if a request leaves the origin.

## UI standards

- WCAG 2.2 AA. Status is **icon + text**, never colour alone. Every control has a visible, programmatic label.
- Keyboard-only operation; focus moves to the page heading on navigation; visible focus ring.
- Works at 360 px width with 44 px tap targets; no horizontal page scroll.
- Every empty, loading, error and success state is designed, not left blank.

## Code standards

TypeScript `strict`; no `any` in `src/` (ESLint enforces); pure domain functions with no browser dependency in
`src/domain/` (so a future backend can reuse them — ADR-0001); UI components stay thin.

## Dependencies

Three runtime dependencies (react, react-dom, dexie) plus zod (lazy-loaded). Adding one needs a justification
in the PR. Dependabot proposes updates weekly; `npm audit` must stay clean.
