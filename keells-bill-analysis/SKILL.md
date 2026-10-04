---
name: keells-bill-analysis
description: "Use when the user supplies Keells Super digibill links (digibill.keellssuper.com/XXXXXX) or asks to analyse, reconcile, or update their grocery bills, monthly grocery spend, or Keells master spreadsheet. Fetches each e-bill, parses the line items, reconciles totals, appends to a running ledger, and rebuilds a master Excel workbook with spend-by-category, discount capture, price movement and loyalty-points tracking. Also handles manually entered receipts from other supermarkets that have no e-bill link."
---

# Keells grocery bill analysis

Turns a batch of Keells Super e-bill links into an updated master workbook.
The ledger is the durable artefact; the workbook is rebuilt from it each run.

## Working layout

```
<workspace>/
  raw/          fetched bill text, one file per ref   (durable record)
  parsed/       parse_bill.py output, one JSON per ref
  data/ledger.json    source of truth, keyed on bill ref
  Keells_master.xlsx  rebuilt every run — never hand-edit
```

Create these on first run. In Cowork, use the project folder. In chat, the user
must upload `data/ledger.json` and you must hand back both the updated ledger
and the workbook at the end, or next month starts from nothing.

## Phase 1 — fetch

**The bill host is not reachable from the code sandbox.** `web_fetch` each URL
yourself and save the returned text to `raw/<REF>.md`, where `<REF>` is the
6-character code at the end of the URL. Do not try to fetch from Python.

Links expire roughly three months after issue. If a fetch fails, say so and
carry on with the rest — do not invent figures from the filename or the date
the user typed.

## Phase 1b — receipts with no e-bill

Other supermarkets issue paper only. If the user sends a photo, read it and
write an input JSON to `receipts/<REF>.json` following
`reference/receipt-template.json`, then:

```bash
python3 scripts/transcribe_receipt.py receipts/*.json --outdir parsed
```

The script recomputes every line (`rate x qty - discount`) and every total
against what you transcribed, so a misread digit surfaces immediately rather
than landing silently in the ledger. Fix the transcription, do not adjust the
printed totals to match.

Long receipts often span two photos with an overlap. Reconcile the overlap
before transcribing — line numbers are the reliable key, not position.

Give the bill a reference the store would recognise: ticket number prefixed by
store, e.g. `GLO900001`. Set `source` so the right department-code map applies;
`fresh_eligible` is forced false for non-Keells sources, since the 25%-off-Fresh
promotion is a Keells scheme.

## Phase 2 — parse and reconcile

```bash
python3 scripts/parse_bill.py raw/*.md --outdir parsed
```

Each bill is checked five ways: line items sum to gross, gross less discount
equals net, tenders sum to net, promotion lines sum to the discount, and points
equal 0.34% of net. Failures print to stderr and land in the Checks column of
the workbook.

**Report every failure to the user. Never quietly accept one.** A failure
usually means the page layout changed and `parse_bill.py` needs a new pattern,
not that the bill is wrong.

## Phase 3 — merge

```bash
python3 scripts/update_ledger.py parsed/*.json --ledger data/ledger.json
```

Bills already present are skipped, so an overlapping batch is harmless. Use
`--force` only when re-parsing after a parser fix.

For a receipt with no e-bill link (another supermarket, a paper bill):

```bash
python3 scripts/update_ledger.py --ledger data/ledger.json \
    --manual 2026-09-02 "Softlogic Glomark" 13832.64 --note "no e-bill link"
```

## Phase 4 — rebuild

```bash
python3 scripts/build_workbook.py --ledger data/ledger.json --out Keells_master.xlsx
python3 /mnt/skills/public/xlsx/scripts/recalc.py Keells_master.xlsx 120
```

Recalc is mandatory — openpyxl writes formulas with no cached values. Never
hand over a workbook while recalc reports `errors_found`.

## Phase 5 — report

Write a short summary in chat. Lead with anything that needs a decision, then
the numbers. Cover:

1. **Reconciliation** — state plainly that all bills tie, or name the ones that don't.
2. **Headline** — bills, gross, discount, net, month-on-month move from the Monthly Trend sheet.
3. **Anomalies first.** Points-ledger gaps mean either a bill the user hasn't
   captured or a bonus credit; convert the gap to implied spend at 0.34% and say
   which reading is plausible. A gap far larger than any realistic basket is a
   credit, not a missing bill. Loyalty points on other schemes have their own
   balances and expiry dates — flag an expiry that is close.
4. **Discount capture** — captured versus the fresh-promotion ceiling. See
   `../docs/rules-evidence.md`. Always call this a ceiling, not a saving.
5. **Price movement** — only items that moved more than 5%.
6. **Anything odd** — duplicate trips the same day, unusual line items, a new store.

The workbook also carries four derived sheets. Re-read them after every rebuild,
because new bills can overturn them:

- **Scheme Model** — the discount rules, each validated against the bills it came
  from. If a validation row stops reproducing, say so and rework the rule before
  quoting any figure that depends on it.
- **Capture Gap** — points-derived estimate of spend missing from the ledger.
  Quote it whenever you state a Keells total.
- **Opportunity** — discount forgone. Always a ceiling; name the overlaps.
- **Replenishment** — cadence per staple, bounded by the capture gap.
- **Subcategory** — the second level under each category, plus a counted
  standing-basket/occasional split and the month-on-month movers. Check the
  catch-all columns after every run: an item landing in an "Other …"
  subcategory means its rule is missing.
- **Daily Cost** — three per-day rates (captured, adjusted, running). Quote the
  one that fits the question and never the captured rate on its own. A month
  containing a Glomark trip reads dearer per day because those baskets carry
  stock, not days of food.

A new bill that contradicts a derived rule is the most valuable thing in the
batch. Lead with it.

Keep it tight. The user prefers concise, production-ready output over
explanation. Present the workbook file at the end.

## Rules

- Never estimate a figure that a bill would have given you. If a fetch fails, the bill is absent, not guessed.
- Categories, the fresh-promotion rules and the points rate are all **inferred**, not printed on the bills. Say so whenever a conclusion leans on them.
- Do not hand-edit the workbook. Fix the ledger and rebuild.
- Keep `raw/` — once a link expires it is the only record of that bill.

## What this skill does not do

- It cannot find the bills. Either the user pastes the links, or an email
  connector is available and you search for the Keells e-bill mails yourself.
- It does not give financial advice. It reports what was spent and where a
  published promotion was not captured.
- The Glomark scheme rules rest on one bill each, and each was seen on a
  different weekday, so day restrictions are unknown. Do not present the card
  recommendation as settled.
- It has only ever seen the Kottawa (SCK3), Mattegoda (SCME) and Aluthgama
  (SIAL) Keells stores, plus Glomark Kottawa. A new Keells store code passes
  through as the raw code — add it to `STORE_NAMES` in `parse_bill.py`. A new
  chain needs a department-prefix entry in `DEPT_PREFIX`.
- Comparing prices across chains needs care: pack sizes differ, and a headline
  discount at one store can sit on a higher shelf price. Compare rate per kg or
  per unit, and say when the packs are not comparable.
