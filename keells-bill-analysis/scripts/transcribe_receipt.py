#!/usr/bin/env python3
"""Turn a hand-transcribed paper receipt into a canonical bill record.

Some stores issue no e-bill. Claude reads the photo, writes a small input JSON,
and this script does the arithmetic, assigns categories and runs the same
reconciliation checks the e-bill parser runs. Nothing here trusts the
transcription — every line and every total is recomputed.

Input format (see reference/receipt-template.json):

    {
      "ref": "GLO900001",
      "source": "glomark",
      "store": "Glomark Demo Branch",
      "store_code": "90000",
      "date": "2026-06-17",
      "time": "18:56",
      "points_earned": 0.9,
      "points_balance_printed": 100,
      "loyalty_scheme": "Softlogic One",
      "printed": {"gross": 250.50, "discount": 25.00, "net": 225.50},
      "tenders": [{"method": "Visa Credit Card-0000", "amount": 225.50}],
      "lines": [
        {"code": "100001", "name": "RICE 5KG", "rate": 100.00, "qty": 2,
         "discount": 25.00, "amount": 175.00, "scheme": "Power Hours 25%"},
        {"code": "100002", "name": "SOAP", "rate": 50.50, "qty": 1,
         "discount": 0.00, "amount": 50.50, "scheme": null}
      ]
    }

`discount` is entered as a positive number however the receipt prints it.
`amount` is the post-discount figure from the receipt.

Usage:
    python3 transcribe_receipt.py receipts/GLO900001.json --outdir parsed
"""
import argparse
import json
import os
import sys
from datetime import datetime

from parse_bill import categorise, is_fresh_eligible, subcategorise


def build(src: dict) -> dict:
    source = src.get("source", "other")
    date = datetime.strptime(src["date"], "%Y-%m-%d").date()

    items, line_errors = [], []
    for n, ln in enumerate(src["lines"], start=1):
        rate, qty = float(ln["rate"]), float(ln["qty"])
        disc = abs(float(ln.get("discount", 0.0)))
        printed = float(ln["amount"])
        calc = round(rate * qty - disc, 2)
        if abs(calc - printed) > 0.02:
            line_errors.append(
                f"line {n} ({ln['code']} {ln['name']}): "
                f"{rate:,.2f} x {qty} - {disc:,.2f} = {calc:,.2f}, "
                f"receipt says {printed:,.2f}")
        items.append(dict(
            code=ln["code"], name=ln["name"],
            unit_price=rate, qty=qty,
            amount=round(rate * qty, 2),          # gross, to match e-bill lines
            net_amount=printed,
            line_discount=disc,
            category=categorise(ln["code"], ln["name"], source),
            subcategory=subcategorise(categorise(ln["code"], ln["name"], source),
                                      ln["name"]),
            fresh_eligible=is_fresh_eligible(ln["code"], source),
        ))

    gross = round(sum(i["amount"] for i in items), 2)
    discount = round(sum(i["line_discount"] for i in items), 2)
    net = round(gross - discount, 2)

    # group line discounts into promotion records by scheme
    by_scheme = {}
    for ln, it in zip(src["lines"], items):
        if it["line_discount"] <= 0:
            continue
        scheme = ln.get("scheme") or "(unlabelled)"
        by_scheme.setdefault(scheme, []).append(it)
    promos = []
    for scheme, its in by_scheme.items():
        promos.append(dict(
            scheme=scheme, line=None, code=None,
            pct=round(sum(i["line_discount"] for i in its)
                      / sum(i["amount"] for i in its) * 100, 1),
            amount=round(sum(i["line_discount"] for i in its), 2),
        ))

    printed = src.get("printed", {})
    tender_sum = round(sum(float(t["amount"]) for t in src["tenders"]), 2)
    checks = {
        "items_equal_gross": abs(gross - printed.get("gross", gross)) < 0.02,
        "gross_less_discount_equals_net": abs(net - printed.get("net", net)) < 0.02,
        "tenders_equal_net": abs(tender_sum - net) < 0.02,
        "promo_lines_equal_discount":
            abs(discount - printed.get("discount", discount)) < 0.02,
        "every_line_arithmetic": not line_errors,
        "item_sum": gross, "tender_sum": tender_sum, "promo_sum": discount,
    }
    if line_errors:
        checks["line_errors"] = line_errors

    return dict(
        ref=src["ref"], source=source,
        date=date.isoformat(), weekday=date.strftime("%a"),
        time=src.get("time", ""), store=src["store"],
        store_code=src.get("store_code", ""),
        gross=gross, discount=discount, net=net,
        points_earned=float(src.get("points_earned", 0.0)),
        points_balance_printed=src.get("points_balance_printed"),
        loyalty_scheme=src.get("loyalty_scheme"),
        tenders=src["tenders"], promotions=promos, items=items,
        transcribed_from=src.get("transcribed_from", "photograph"),
        checks=checks,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--outdir", default="parsed")
    args = ap.parse_args()
    rc = 0
    for path in args.files:
        with open(path, encoding="utf-8") as fh:
            bill = build(json.load(fh))
        bad = [k for k, v in bill["checks"].items()
               if isinstance(v, bool) and not v]
        os.makedirs(args.outdir, exist_ok=True)
        with open(os.path.join(args.outdir, f"{bill['ref']}.json"), "w") as fh:
            json.dump(bill, fh, indent=2)
        print(f"{bill['ref']}: {len(bill['items'])} lines, "
              f"gross {bill['gross']:,.2f} disc {bill['discount']:,.2f} "
              f"net {bill['net']:,.2f}"
              f"{'  [CHECK FAILED: ' + ', '.join(bad) + ']' if bad else '  OK'}")
        for e in bill["checks"].get("line_errors", []):
            print(f"    {e}", file=sys.stderr)
            rc = 2
        if bad:
            rc = 2
    sys.exit(rc)


if __name__ == "__main__":
    main()
