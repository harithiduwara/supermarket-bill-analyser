#!/usr/bin/env node
// NFR-08 gate: the main JS bundle must stay within budget (gzip). Run after `npm run build`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUDGET_KB = 120; // main bundle: what every visitor downloads
const LAZY_BUDGET_KB = 300; // the Excel library, fetched only on export/import
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../dist/assets");
const main = fs.readdirSync(dir).find((f) => /^index-.*\.js$/.test(f));
if (!main) {
  console.error("no dist/assets/index-*.js — run `npm run build` first");
  process.exit(1);
}
const kb = zlib.gzipSync(fs.readFileSync(path.join(dir, main))).length / 1024;
console.log(`main bundle ${main}: ${kb.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB)`);
const lazy = fs.readdirSync(dir).filter((f) => /^exceljs.*\.js$/.test(f));
let failed = kb > BUDGET_KB;
for (const f of lazy) {
  const lkb = zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length / 1024;
  console.log(`lazy chunk ${f}: ${lkb.toFixed(1)} kB gzip (budget ${LAZY_BUDGET_KB} kB)`);
  if (lkb > LAZY_BUDGET_KB) failed = true;
}
if (!lazy.length) {
  console.error("expected a lazy exceljs chunk (is the workbook code still loaded on demand?)");
  failed = true;
}
if (failed) {
  console.error("over budget");
  process.exit(1);
}
