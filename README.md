# Grocery bill ledger (Keells / Glomark)

Ingests Sri Lankan supermarket bills into a reconciled ledger. A static site: it runs entirely in the
browser, so it can be hosted on GitHub Pages. **Phase 1 of 4** (ingest and reconcile) is built.

`keells-bill-analysis/` is the original Python implementation, kept as read-only reference. The domain
logic in `src/domain/` is a port of it, and `tests/seed.test.ts` checks the port against the Python's own
`ledger.json` on all 24 real bills.

## How it works
- **Ledger** = IndexedDB in your browser, seeded with the 24 bills. Only printed/transcribed facts are
  stored; categories, schemes etc. will be derived on read.
- **Idempotent:** bills are keyed on their reference (`FYQQRQ`, `GLO546052`); re-submitting is a no-op.
- **Reconciliation blocks the save:** items = gross, gross - discount = net, tenders = net, promotions =
  discount, points = 0.34% of net (Keells only), plus per-line arithmetic on photo receipts. Tolerance 0.02.
- **Keells e-bill:** paste the link and the page content (a browser cannot fetch digibill cross-origin).
- **Photo receipt:** Claude reads it into an editable table; save stays disabled until every check passes.

## Settings
Photo OCR needs an Anthropic API key (Settings tab; stored in this browser only, sent only to
api.anthropic.com). The model is configurable; default `claude-sonnet-5-5`, or set `VITE_ANTHROPIC_MODEL`
at build time. Check the current model list in the Anthropic docs.

## Develop
    npm ci
    npm run dev        # local
    npm test           # 81 tests
    npm run build      # -> dist/

## Deploy to GitHub Pages
1. Merge to `main`.
2. Repo Settings > Pages > Source: GitHub Actions.
3. `.github/workflows/pages.yml` tests, builds and publishes on every push to `main`.

## Backup
The ledger lives only in your browser. Use Settings > Export ledger regularly.
