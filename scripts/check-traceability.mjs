#!/usr/bin/env node
// Requirements traceability gate (see docs/requirements.md, "Definition of Done").
// Every user story marked Must/Should and built (✅ or 🔨), and every NFR, must be named in at least one
// automated test title — so "done" is evidenced by a test, not asserted by a document.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const doc = fs.readFileSync(path.join(root, "docs/requirements.md"), "utf8");

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : /\.(test|spec)\.ts$/.test(e.name)
          ? [path.join(dir, e.name)]
          : [],
    );
}
const tests = walk(path.join(root, "tests"))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

const stories = [...doc.matchAll(/\*\*(US-\d+)\b[^*]*\*\*[^\n]*?—\s*(Must|Should)[^\n]*?(✅|🔨)/g)].map(
  (m) => m[1],
);
// NFR rows: | ID | Category | Requirement | Verified by |. Those verified by a test must be named in one;
// those verified by CI or review (their "Verified by" cell says so, and names no test) are listed, not hidden.
const nfrRows = [...doc.matchAll(/^\|\s*(NFR-\d+)\s*\|[^|]*\|[^|]*\|([^|]*)\|\s*$/gm)].map((m) => ({
  id: m[1],
  by: m[2],
}));
const byTest = nfrRows
  .filter((r) => /\btest\b|e2e|\.spec|\.test/.test(r.by) && !/not a test title/.test(r.by))
  .map((r) => r.id);
const byCi = nfrRows.filter((r) => !byTest.includes(r.id)).map((r) => r.id);
const nfrs = byTest;

const missing = [...new Set([...stories, ...nfrs])].filter((id) => !new RegExp(`\\b${id}\\b`).test(tests));
const covered = stories.length + nfrs.length - missing.length;
console.log(
  `traceability: ${covered}/${stories.length + nfrs.length} built stories and test-verified NFRs are named in a test`,
);
console.log(`verified by CI or review instead of a test: ${byCi.join(", ") || "none"}`);
if (missing.length) {
  console.error(`NOT COVERED by any test title: ${missing.join(", ")}`);
  process.exit(1);
}
