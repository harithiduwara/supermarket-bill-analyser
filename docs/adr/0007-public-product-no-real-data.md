# ADR-0007: A public product ships no real data

Status: accepted · Date: 2026-10-04

## Context

The app is a public static site (ADR-0001) and the repository was public. The first deploy bundled 24 real bills
(store details, card suffixes, bill references) as starting data and test fixtures. That exposed a real person's
purchasing history. It was a mistake of mine not to warn about it before publishing.

## Decision

1. **No real data in the repository or the bundle.** The app starts empty. "Load demo data" generates fake bills
   (`src/domain/demo.ts`, seeded RNG, fake store text, card suffixes `0000`–`0002`), flagged `demo`, removable in one
   click, and never written to a workbook or JSON backup (US-26).
2. **Tests use the generator**, with round-trip property tests through the real parser and reconciler. Honest limit:
   the generator embeds the inferred scheme rules, so these tests prove the code is self-consistent, not that the rules
   match the real world.
3. **Parity with real bills stays possible, privately.** `tests/unit/private-parity.test.ts` runs only when
   `REAL_FIXTURES_DIR` points at a local folder; it is skipped in CI.
4. **A guard enforces it.** `scripts/check-privacy.mjs` scans tracked files against SHA-256 hashes of the known
   identifiers (the hashes live in `scripts/personal-data.sha256`, not the values), and runs in `verify` and CI.
5. **Rules evidence is anonymised** (`docs/rules-evidence.md`): patterns and observation counts, no bill content.

## Consequences

- The first-run screen is empty rather than impressive; the demo button covers that.
- Git history before this change still contains the real data. Removing it needs a history rewrite and force-push,
  which is destructive and changes every commit hash; it is done only with the owner's explicit agreement
  (`git filter-repo`, then re-publish). Until then the repository should be private and the old Pages deploy unpublished.
- Anyone who already cloned or forked holds a copy; that cannot be undone from here.
