#!/usr/bin/env python3
"""Merge parsed bills into the running ledger. Safe to re-run.

The ledger is the source of truth; the workbook is rebuilt from it every time.
Bills are keyed on their digibill reference, so pasting an overlapping batch
adds nothing twice.

Usage:
    python3 update_ledger.py parsed/*.json --ledger data/ledger.json
    python3 update_ledger.py --ledger data/ledger.json \
        --manual 2026-09-02 "Softlogic Glomark" 13832.64
"""
import argparse
import glob
import json
import os
import sys


def load(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return {"bills": {}, "manual": []}


def save(path, ledger):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(ledger, fh, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--ledger", default="data/ledger.json")
    ap.add_argument("--manual", nargs=3, metavar=("DATE", "STORE", "AMOUNT"),
                    help="record a non-Keells receipt with no e-bill link")
    ap.add_argument("--note", default="")
    ap.add_argument("--force", action="store_true",
                    help="overwrite bills already in the ledger")
    args = ap.parse_args()

    ledger = load(args.ledger)
    added, skipped, failed = [], [], []

    paths = []
    for f in args.files:
        paths.extend(sorted(glob.glob(f)) or [f])

    for path in paths:
        with open(path, encoding="utf-8") as fh:
            bill = json.load(fh)
        ref = bill["ref"]
        bad = [k for k, v in bill.get("checks", {}).items()
               if isinstance(v, bool) and not v]
        if bad:
            failed.append((ref, bad))
        if ref in ledger["bills"] and not args.force:
            skipped.append(ref)
            continue
        ledger["bills"][ref] = bill
        added.append(ref)

    if args.manual:
        date, store, amount = args.manual
        entry = {"date": date, "store": store,
                 "amount": float(amount), "note": args.note}
        if entry not in ledger["manual"]:
            ledger["manual"].append(entry)
            ledger["manual"].sort(key=lambda e: e["date"])
            added.append(f"manual:{store} {date}")
        else:
            skipped.append(f"manual:{store} {date}")

    save(args.ledger, ledger)

    print(f"added   : {len(added)}  {', '.join(added) if added else '-'}")
    print(f"skipped : {len(skipped)} already in ledger"
          f"{'  (' + ', '.join(skipped) + ')' if skipped else ''}")
    print(f"ledger  : {len(ledger['bills'])} bills, "
          f"{len(ledger['manual'])} manual entries")
    if failed:
        print("\nRECONCILIATION FAILURES — report these, do not silently accept:",
              file=sys.stderr)
        for ref, bad in failed:
            print(f"  {ref}: {', '.join(bad)}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
