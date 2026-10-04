#!/usr/bin/env node
// NFR-08 gate: the main JS bundle must stay within budget (gzip). Run after `npm run build`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUDGET_KB = 120;
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../dist/assets");
const main = fs.readdirSync(dir).find((f) => /^index-.*\.js$/.test(f));
if (!main) {
  console.error("no dist/assets/index-*.js — run `npm run build` first");
  process.exit(1);
}
const kb = zlib.gzipSync(fs.readFileSync(path.join(dir, main))).length / 1024;
console.log(`main bundle ${main}: ${kb.toFixed(1)} kB gzip (budget ${BUDGET_KB} kB)`);
if (kb > BUDGET_KB) {
  console.error("over budget");
  process.exit(1);
}
