# ADR-0004: OCR with the user's own Anthropic key, called from the browser

Status: accepted · Date: 2026-10-04

## Context

With no backend there is nowhere to hold a shared secret. Embedding a key in the bundle would publish it.

## Decision

The user supplies their own key. It is held in memory for the session by default; "remember on this device"
(localStorage) is opt-in and can be cleared in one click. The request uses the
`anthropic-dangerous-direct-browser-access` header. The model name is configurable, never hard-wired.

## Consequences

- No secret in the repository or bundle. − A key in browser storage is exposed to any script on the origin;
  mitigated by a strict CSP (no third-party scripts), session-only default, and advice to use a spend-limited key.
  The OCR output is untrusted input: it is schema-validated, shown for confirmation and never auto-saved.
