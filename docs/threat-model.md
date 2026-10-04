# Threat model (STRIDE-lite)

Assets: the ledger (spending history), the Anthropic API key, receipt photos.
Trust boundary: the browser tab ↔ api.anthropic.com. There is no server of ours.

| Threat                               | Vector                                                 | Control                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Key theft (I)                        | XSS or a malicious script on the origin                | CSP `script-src 'self'`; no third-party scripts or CDNs; React escaping; no `dangerouslySetInnerHTML`; session-only key by default |
| Key theft (I)                        | Shared computer                                        | Opt-in persistence, one-click clear, UI warning                                                                                    |
| Hostile import file (T/D)            | Crafted JSON: wrong types, huge arrays, prototype keys | Size cap, zod schema with bounds, every bill re-reconciled, unknown keys stripped                                                  |
| OCR prompt injection (T)             | Text printed on a receipt instructs the model          | Output constrained to a tool schema, validated, shown for human confirmation, never auto-saved                                     |
| Data loss (D)                        | Storage eviction/clearing                              | `navigator.storage.persist()`, backup reminder, export                                                                             |
| Tampering with ledger (T)            | Local user edits IndexedDB                             | Out of scope: single-user, local data; audit log is informational                                                                  |
| Supply chain (T)                     | Malicious dependency                                   | Lockfile, `npm ci`, Dependabot, `npm audit`, CodeQL, minimal dependency set (react, dexie, zod)                                    |
| Info disclosure via referrer/framing | Navigation, embedding                                  | `Referrer-Policy: no-referrer` meta; GitHub Pages cannot set frame headers — accepted, no sensitive action is one click            |

Residual risk accepted: GitHub Pages cannot send HTTP security headers, so CSP is delivered by `<meta>` (no
`frame-ancestors`, no report-uri).
