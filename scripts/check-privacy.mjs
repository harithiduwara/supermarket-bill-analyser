#!/usr/bin/env node
// Privacy gate: no real customer data in the repository.
//
// The app ships to a PUBLIC audience, so the original owner's real bills must never be in the repo or the bundle.
// scripts/personal-data.sha256 holds one-way hashes of identifying tokens from those bills (customer name, bill and
// ticket references, till/receipt ids, card suffixes). This scans every tracked text file, hashes each
// alphanumeric token, and fails on a match. It reports file:line only — never the token itself.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LIST = "scripts/personal-data.sha256";
const banned = new Set(
  fs
    .readFileSync(path.join(root, LIST), "utf8")
    .split("\n")
    .filter((l) => /^[0-9a-f]{64}$/.test(l.trim()))
    .map((l) => l.trim()),
);

const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const hits = [];
let scanned = 0;
for (const f of files) {
  if (f === LIST) continue;
  const full = path.join(root, f);
  if (!fs.existsSync(full)) continue; // deleted in the working tree
  const buf = fs.readFileSync(full);
  if (buf.length > 2_000_000 || buf.includes(0)) continue; // binary or huge
  scanned++;
  buf
    .toString("utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const tok of line.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length >= 4 && banned.has(crypto.createHash("sha256").update(tok).digest("hex"))) {
          hits.push(`${f}:${i + 1}`);
          break;
        }
      }
    });
}
console.log(`privacy: scanned ${scanned} files against ${banned.size} hashed identifiers`);
if (hits.length) {
  console.error(`REAL CUSTOMER DATA FOUND in ${hits.length} place(s):`);
  const shown = process.argv.includes("--all") ? hits : hits.slice(0, 40);
  for (const h of shown) console.error(`  ${h}`);
  if (!process.argv.includes("--all") && hits.length > 40) console.error(`  … and ${hits.length - 40} more`);
  console.error(
    "Use synthetic data (src/domain/demo.ts). Real bills belong only in a user's own workbook or backup.",
  );
  process.exit(1);
}
