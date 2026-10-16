# ADR-0008: Encrypted profiles on this device

Status: accepted · Date: 2026-10-16 · Refines ADR-0001 (still no server)

## Context

The product is public. People will use it on shared and borrowed computers, and a browser's IndexedDB is readable by
anyone with the device and the profile. The owner asked for email + password registration with encrypted per-user data.
A GitHub Pages site has no server, so nothing here can be verified by a server and no secret can be held for the user.

## Decision

Profiles live **on the device**, encrypted with WebCrypto only (no third-party crypto code):

- **Keys.** Each profile has two random 256-bit keys: an AES-GCM key that seals every record and an HMAC key that makes
  record ids. Both are stored only _wrapped_ (AES-GCM) by a key derived from the password with **PBKDF2-SHA256,
  600,000 iterations** and a random salt, and again by a key derived (HKDF) from a 160-bit **recovery key**.
- **Records.** Every bill, photo, activity event, and setting is sealed with a fresh random IV. The record's location
  (`profile|table|id`) is authenticated as additional data, so a record moved to another slot or profile does not open.
  Record ids are HMACs, so IndexedDB reveals only how many records exist, not which bill references.
- **Sign-in.** Unwrapping the keys is the password check: a wrong password fails the AES-GCM tag. An unknown email and a
  wrong password give the same message and cost the same time. The email is stored only as a SHA-256 hash (for lookup)
  and, sealed, for display after sign-in.
- **Recovery.** A password reset needs the recovery key and issues a new one. Changing the password, making a new
  recovery key and deleting a profile all require the current password.
- **Sessions.** After unwrapping, the keys are non-extractable `CryptoKey`s. To survive a reload they are kept in
  IndexedDB under a token that lives in `sessionStorage`, so closing the tab ends the session; entries expire after the
  idle time (5/15/30/60 minutes, default 15) and are deleted on lock.
- **Before profiles existed.** Bills in the old unencrypted database can be moved into a profile; the original is deleted
  only after the copy is verified.

## Consequences and honest limits

- **No password or recovery key = no data.** Nobody, including the maintainers, can recover it. The UI says so; the
  exported workbook (not encrypted) is the real backup.
- **Offline guessing.** Someone with a copy of the browser profile can try passwords offline. PBKDF2 at this cost slows
  that; a weak password still falls. We require 10+ characters and show a strength hint; we cannot do more without a
  server. (Argon2 is not in WebCrypto.)
- **XSS.** Script running in the page while a profile is unlocked can use the keys (it cannot read them out). The strict
  CSP and no third-party scripts (ADR-0001, NFR-04) are the control.
- **Rollback and deletion.** Per-record authentication stops tampering and swapping, not deleting records or restoring an
  older copy of the database.
- **Exports are not encrypted.** Workbooks and JSON backups are ordinary files; the UI says so.
- **Email is a label.** It is not verified and no mail is sent; there is no "email me a reset link".
- **Not yet encrypted:** the opt-in "remember API key" (localStorage), and the last-export timestamp (shared across
  profiles on a device). Follow-ups.
- **Backend option (Design B)**, a server that stores only ciphertext so a profile follows the person across devices, is
  possible later; it would need hosting beyond GitHub Pages and is not part of this decision.
