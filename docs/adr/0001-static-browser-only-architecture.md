# ADR-0001: Static, browser-only architecture

Status: accepted · Date: 2026-10-04

## Context

The product is single-user. The requested host is GitHub Pages, which serves static files only.

## Decision

Ship a static single-page app. The ledger lives in the browser's IndexedDB. All logic runs client-side.

## Consequences

- No server to run, patch or pay for; deploys from CI; data never leaves the device (except OCR photos).
- Domain logic is pure functions, testable without infrastructure.
  − No multi-device sync, multi-user, SSO or server-side audit. These are **Won't** for this release.
  − The user is responsible for backups (mitigated by export, reminder, persistent storage).

## Migration path if those become requirements

Keep `src/domain/` unchanged (it has no browser dependency). Replace `LedgerStore` (`DexieStore`) with an API
client; add a small service (e.g. Postgres + OIDC) that implements the same interface and re-runs `reconcile()`
server-side. The `LedgerStore` interface and the export format are the seams.
