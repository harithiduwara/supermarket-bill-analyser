# Security policy

## Reporting a vulnerability

Use GitHub's private advisory form: **Security → Report a vulnerability**. Please do not open a public issue.
You can expect an acknowledgement within a week.

## What this app is, security-wise

A static, browser-only app. There is no server of ours: no accounts, no database, no telemetry. The ledger lives
in the browser's IndexedDB. The only network egress is to `api.anthropic.com`, and only when you press “Read” on
a receipt photo. See [`docs/threat-model.md`](docs/threat-model.md) and [`docs/adr/0004`](docs/adr/0004-bring-your-own-api-key.md).

## Things worth knowing

- The Anthropic API key you enter is kept for the browser tab only, unless you tick “remember on this device”.
  Use a key with a spend limit and never on a shared computer.
- GitHub Pages cannot send HTTP security headers, so the Content-Security-Policy ships as a `<meta>` tag
  (no `frame-ancestors`). Accepted and documented.
- Imported ledger files are untrusted: size-capped, schema-validated, and every bill is re-reconciled.
- OCR output is untrusted: validated, shown for human confirmation, never saved automatically.

## Out of scope

Anything that requires write access to the user's own browser profile or device.
