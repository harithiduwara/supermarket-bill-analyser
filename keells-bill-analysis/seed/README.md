# Seed data — Jul/Aug/Sep 2026

`data/ledger.json` holds 24 fully itemised bills from 30-Jul-2026 to
03-Oct-2026: 21 Keells e-bills plus three Glomark Kottawa receipts
transcribed from photographs. The first run continues an existing ledger
rather than starting empty.

- `raw/` — fetched text of each Keells e-bill
- `receipts/` — transcription input for the Glomark receipt

Copy `data/` and `raw/` into your working folder (the Cowork project folder, or
wherever you keep the workbook) before the first run.

`raw/` holds the fetched text of every bill. Keep it — the digibill links
expire about three months after issue, and after that this is the only record.

To rebuild the workbook from the seed without fetching anything:

    python3 scripts/build_workbook.py --ledger data/ledger.json --out Keells_master.xlsx
    python3 /mnt/skills/public/xlsx/scripts/recalc.py Keells_master.xlsx 120
