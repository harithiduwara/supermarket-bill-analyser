# ADR-0002: Paste e-bill content rather than fetch the link

Status: accepted · Date: 2026-10-04

## Context

The original design fetched `digibill.keellssuper.com/XXXXXX` server-side. A browser cannot: the host does not
send CORS headers. A third-party CORS proxy would send bill contents (store, items, card last four) to a party
we do not control.

## Decision

The user opens the link and pastes the page (text or HTML). The bill reference comes from the link.

## Consequences

- No third party sees financial data. − One extra step for the user.
  − The HTML→text step is **unverified** against the live page (the seed holds fetched text only). Parsing fails
  loudly and the plain-text paste path is the documented fallback. Re-open this ADR if a backend is added (ADR-0001).
