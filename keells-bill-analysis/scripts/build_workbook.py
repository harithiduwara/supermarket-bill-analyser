#!/usr/bin/env python3
"""Rebuild the master workbook from the ledger.

Full rebuild, not an in-place append: openpyxl edits to an existing sheet tend
to break named ranges and formatting over time, and a rebuild is idempotent by
construction. The ledger is the durable artefact; the .xlsx is a rendering.

Usage:
    python3 build_workbook.py --ledger data/ledger.json --out Keells_master.xlsx
"""
import argparse
import datetime
import json
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

import analysis

FONT = "Arial"
MONEY = '#,##0.00;(#,##0.00);-'
PCT = '0.0%'
NUM = '#,##0.00'
HDR_FILL = PatternFill("solid", fgColor="1F3864")
SUB_FILL = PatternFill("solid", fgColor="D9E2F3")
FLAG_FILL = PatternFill("solid", fgColor="FFF2CC")
HDR_FONT = Font(name=FONT, size=10, bold=True, color="FFFFFF")
BOLD = Font(name=FONT, size=10, bold=True)
BASE = Font(name=FONT, size=10)
BLUE = Font(name=FONT, size=10, color="0000FF")
TITLE = Font(name=FONT, size=13, bold=True, color="1F3864")
NOTE = Font(name=FONT, size=9, italic=True, color="595959")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)

FRESH_PREFIX = {"912", "913", "914", "915", "916", "923", "935"}
FRESH_CAP = 1500.00
FRESH_RATE = 0.25
POINTS_RATE = 0.0034
CATEGORY_ORDER = [
    "Meat & fish", "Dairy & eggs", "Staples & grocery", "Beverages", "Bakery",
    "Vegetables", "Fruit", "Snacks & confectionery", "Condiments & spices",
    "Instant noodles", "Processed meat", "Household & personal care",
    "Other grocery", "Bags",
]


def hdr(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font, cell.fill = HDR_FONT, HDR_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        cell.border = BOX


def widths(ws, ws_widths):
    for i, w in enumerate(ws_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def paint(ws, r1, r2, c1, c2, money=(), pct=(), num=()):
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            cell = ws.cell(row=r, column=c)
            cell.font, cell.border = BASE, BOX
            if c in money:
                cell.number_format = MONEY
            if c in pct:
                cell.number_format = PCT
            if c in num:
                cell.number_format = NUM


def band(ws, row, text, span=3):
    ws.cell(row=row, column=1, value=text).font = BOLD
    for c in range(1, span + 1):
        ws.cell(row=row, column=c).fill = SUB_FILL
        ws.cell(row=row, column=c).border = BOX


def got_fresh_promo(bill):
    return any(p["scheme"] and "off on Fresh" in p["scheme"]
               for p in bill["promotions"])


def fresh_base(bill):
    """Eligible fresh value, net of line-level discounts on those same lines."""
    line_disc = defaultdict(float)
    for p in bill["promotions"]:
        if p["code"]:
            line_disc[p["code"]] += p["amount"]
    return sum(i["amount"] - line_disc.get(i["code"], 0.0)
               for i in bill["items"] if i["code"][:3] in FRESH_PREFIX)


def build(ledger, out_path):
    bills = sorted(ledger["bills"].values(), key=lambda b: (b["date"], b["time"]))
    manual = sorted(ledger.get("manual", []), key=lambda e: e["date"])
    if not bills:
        raise SystemExit("ledger has no bills")

    wb = Workbook()

    # ---------------------------------------------------------- Line Items
    ws = wb.create_sheet("Line Items")
    ws["A1"] = "All bill lines"
    ws["A1"].font = TITLE
    cols = ["Date", "Month", "Weekday", "Store", "Bill ref", "Item code", "Item",
            "Unit price (Rs)", "Qty", "Amount (Rs)", "Category", "Subcategory",
            "Fresh-eligible", "Source"]
    for i, h in enumerate(cols, 1):
        ws.cell(row=3, column=i, value=h)
    hdr(ws, 3, len(cols))
    r = 4
    for b in bills:
        d = datetime.date.fromisoformat(b["date"])
        for it in b["items"]:
            ws.cell(row=r, column=1, value=d).number_format = "dd-mmm-yyyy"
            ws.cell(row=r, column=2, value=b["date"][:7])
            ws.cell(row=r, column=3, value=b["weekday"])
            ws.cell(row=r, column=4, value=b["store"])
            ws.cell(row=r, column=5, value=b["ref"])
            ws.cell(row=r, column=6, value=it["code"])
            ws.cell(row=r, column=7, value=it["name"])
            ws.cell(row=r, column=8, value=it["unit_price"])
            ws.cell(row=r, column=9, value=it["qty"])
            ws.cell(row=r, column=10, value=it["amount"])
            ws.cell(row=r, column=11, value=it["category"])
            ws.cell(row=r, column=12, value=it.get("subcategory", ""))
            ws.cell(row=r, column=13, value="Y" if it["fresh_eligible"] else "")
            ws.cell(row=r, column=14, value=b.get("source", "keells"))
            r += 1
    li_last = r - 1
    ws.cell(row=r, column=7, value="TOTAL GROSS").font = BOLD
    c = ws.cell(row=r, column=10, value=f"=SUM(J4:J{li_last})")
    c.font, c.number_format = BOLD, MONEY
    paint(ws, 4, li_last, 1, 14, money=(8, 10), num=(9,))
    widths(ws, [12, 9, 9, 16, 11, 11, 46, 15, 9, 14, 24, 26, 13, 10])
    ws.freeze_panes = "A4"
    ws.auto_filter.ref = f"A3:N{li_last}"
    LI = "'Line Items'"

    # -------------------------------------------------------------- Bills
    ws = wb.create_sheet("Bills")
    ws["A1"] = "One row per bill"
    ws["A1"].font = TITLE
    cols = ["Date", "Month", "Weekday", "Time", "Store", "Bill ref", "Lines",
            "Gross (Rs)", "Discount (Rs)", "Net (Rs)", "Discount %",
            "Fresh base (Rs)", "Fresh promo?", "Payment method(s)",
            "Points earned", "Checks", "Source"]
    for i, h in enumerate(cols, 1):
        ws.cell(row=3, column=i, value=h)
    hdr(ws, 3, len(cols))
    r = 4
    for b in bills:
        d = datetime.date.fromisoformat(b["date"])
        bad = [k for k, v in b.get("checks", {}).items()
               if isinstance(v, bool) and not v]
        ws.cell(row=r, column=1, value=d).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value=b["date"][:7])
        ws.cell(row=r, column=3, value=b["weekday"])
        ws.cell(row=r, column=4, value=b["time"])
        ws.cell(row=r, column=5, value=b["store"])
        ws.cell(row=r, column=6, value=b["ref"])
        ws.cell(row=r, column=7, value=len(b["items"]))
        ws.cell(row=r, column=8, value=f'=SUMIF({LI}!$E:$E,F{r},{LI}!$J:$J)')
        ws.cell(row=r, column=9, value=b["discount"])
        ws.cell(row=r, column=10, value=f"=H{r}-I{r}")
        ws.cell(row=r, column=11, value=f"=IFERROR(I{r}/H{r},0)")
        ws.cell(row=r, column=12, value=round(fresh_base(b), 2))
        ws.cell(row=r, column=13, value="Y" if got_fresh_promo(b) else "")
        ws.cell(row=r, column=14,
                value=" + ".join(f"{t['method']} {t['amount']:,.2f}"
                                 for t in b["tenders"]))
        ws.cell(row=r, column=15, value=b["points_earned"])
        cell = ws.cell(row=r, column=16, value="OK" if not bad else "; ".join(bad))
        if bad:
            cell.fill = FLAG_FILL
        ws.cell(row=r, column=17, value=b.get("source", "keells"))
        r += 1
    b_last = r - 1
    ws.cell(row=r, column=5, value="TOTAL").font = BOLD
    for col in (7, 8, 9, 10, 12, 15):
        L = get_column_letter(col)
        cell = ws.cell(row=r, column=col, value=f"=SUM({L}4:{L}{b_last})")
        cell.font = BOLD
        cell.number_format = MONEY if col in (8, 9, 10, 12) else NUM
    cell = ws.cell(row=r, column=11, value=f"=IFERROR(I{r}/H{r},0)")
    cell.font, cell.number_format = BOLD, PCT
    paint(ws, 4, b_last, 1, 17, money=(8, 9, 10, 12), pct=(11,), num=(15,))
    widths(ws, [12, 9, 9, 7, 16, 11, 7, 13, 13, 13, 11, 14, 12, 46, 13, 26, 10])
    ws.freeze_panes = "A4"
    BS, B4, BL = "Bills", 4, b_last

    # ------------------------------------------------------------ Summary
    ws = wb.create_sheet("Summary", 0)
    ws["A1"] = "Grocery ledger"
    ws["A1"].font = Font(name=FONT, size=15, bold=True, color="1F3864")
    span = f"{bills[0]['date']} to {bills[-1]['date']}"
    days = (datetime.date.fromisoformat(bills[-1]["date"])
            - datetime.date.fromisoformat(bills[0]["date"])).days + 1
    ws["A2"] = (f"{len(bills)} bills, {span} ({days} days). "
                f"Rebuilt {datetime.date.today():%d-%b-%Y} from data/ledger.json.")
    ws["A2"].font = NOTE

    band(ws, 4, "HEADLINE")
    rows = [
        ("Bills", f"=COUNT({BS}!H{B4}:H{BL})", '#,##0'),
        ("Bill lines", f"=SUM({BS}!G{B4}:G{BL})", '#,##0'),
        ("Gross (Rs)", f"=SUM({BS}!H{B4}:H{BL})", MONEY),
        ("Discount (Rs)", f"=SUM({BS}!I{B4}:I{BL})", MONEY),
        ("Net paid, all itemised bills (Rs)", f"=SUM({BS}!J{B4}:J{BL})", MONEY),
        ("Un-itemised receipts (Rs)", "='Other Stores'!B2", MONEY),
        ("TOTAL GROCERY SPEND (Rs)", "=B9+B10", MONEY),
        ("Effective discount rate", "=B8/B7", PCT),
        ("Average basket, net (Rs)", "=B9/B5", MONEY),
        ("Median basket, net (Rs)", f"=MEDIAN({BS}!J{B4}:J{BL})", MONEY),
        ("Days covered", days, '#,##0'),
        ("Spend per day (Rs)", "=B11/B15", MONEY),
        ("Points earned", f"=SUM({BS}!O{B4}:O{BL})", NUM),
    ]
    r = 5
    for label, val, fmt in rows:
        ws.cell(row=r, column=1, value=label).font = (
            BOLD if label.startswith("TOTAL") else BASE)
        c = ws.cell(row=r, column=2, value=val)
        c.number_format = fmt
        c.font = BOLD if label.startswith("TOTAL") else BASE
        if label.startswith("TOTAL"):
            c.fill = FLAG_FILL
        ws.cell(row=r, column=1).border = BOX
        c.border = BOX
        r += 1

    r += 1
    band(ws, r, "SPEND BY CATEGORY (gross)")
    r += 1
    for i, h in enumerate(["Category", "Gross (Rs)", "Share"], 1):
        ws.cell(row=r, column=i, value=h)
    hdr(ws, r, 3)
    r += 1
    cat_start = r
    present = [c for c in CATEGORY_ORDER
               if any(i["category"] == c for b in bills for i in b["items"])]
    for cat in present:
        ws.cell(row=r, column=1, value=cat).font = BASE
        ws.cell(row=r, column=2,
                value=f'=SUMIF({LI}!$K:$K,A{r},{LI}!$J:$J)').number_format = MONEY
        r += 1
    cat_end = r - 1
    for rr in range(cat_start, cat_end + 1):
        ws.cell(row=rr, column=3, value=f"=B{rr}/$B${cat_end + 1}").number_format = PCT
    ws.cell(row=r, column=1, value="TOTAL").font = BOLD
    for col, f in ((2, f"=SUM(B{cat_start}:B{cat_end})"),
                   (3, f"=SUM(C{cat_start}:C{cat_end})")):
        c = ws.cell(row=r, column=col, value=f)
        c.font = BOLD
        c.number_format = MONEY if col == 2 else PCT
    paint(ws, cat_start, r, 1, 3, money=(2,), pct=(3,))

    r += 2
    band(ws, r, "BY STORE")
    r += 1
    for i, h in enumerate(["Store", "Bills", "Net (Rs)"], 1):
        ws.cell(row=r, column=i, value=h)
    hdr(ws, r, 3)
    r += 1
    st_start = r
    for s in sorted({b["store"] for b in bills}):
        ws.cell(row=r, column=1, value=s).font = BASE
        ws.cell(row=r, column=2,
                value=f'=COUNTIF({BS}!$E${B4}:$E${BL},A{r})').number_format = '#,##0'
        ws.cell(row=r, column=3,
                value=f'=SUMIF({BS}!$E${B4}:$E${BL},A{r},{BS}!$J${B4}:$J${BL})'
                ).number_format = MONEY
        r += 1
    paint(ws, st_start, r - 1, 1, 3, money=(3,))

    r += 1
    band(ws, r, "BY PAYMENT METHOD")
    r += 1
    for i, h in enumerate(["Method", "Amount (Rs)", "Share"], 1):
        ws.cell(row=r, column=i, value=h)
    hdr(ws, r, 3)
    r += 1
    pay = defaultdict(float)
    for b in bills:
        for t in b["tenders"]:
            pay[t["method"]] += t["amount"]
    pay_start = r
    for k, v in sorted(pay.items(), key=lambda x: -x[1]):
        ws.cell(row=r, column=1, value=k).font = BASE
        c = ws.cell(row=r, column=2, value=round(v, 2))
        c.font, c.number_format = BLUE, MONEY
        r += 1
    pay_end = r - 1
    for rr in range(pay_start, pay_end + 1):
        ws.cell(row=rr, column=3, value=f"=B{rr}/$B${pay_end + 1}").number_format = PCT
    ws.cell(row=r, column=1, value="TOTAL").font = BOLD
    c = ws.cell(row=r, column=2, value=f"=SUM(B{pay_start}:B{pay_end})")
    c.font, c.number_format = BOLD, MONEY
    paint(ws, pay_start, r, 1, 3, money=(2,), pct=(3,))
    r += 2
    ws.cell(row=r, column=1,
            value="Blue = value carried from the bill. Black = formula.").font = NOTE
    widths(ws, [42, 18, 12])

    # ------------------------------------------------------ Monthly Trend
    ws = wb.create_sheet("Monthly Trend")
    ws["A1"] = "Month on month"
    ws["A1"].font = TITLE
    cols = ["Month", "Bills", "Gross (Rs)", "Discount (Rs)", "Net (Rs)",
            "Discount %", "Fresh base (Rs)", "Avg basket (Rs)"]
    for i, h in enumerate(cols, 1):
        ws.cell(row=3, column=i, value=h)
    hdr(ws, 3, len(cols))
    r = 4
    for month in sorted({b["date"][:7] for b in bills}):
        ws.cell(row=r, column=1, value=month).font = BASE
        ws.cell(row=r, column=2, value=f'=COUNTIF({BS}!$B:$B,A{r})')
        for col, src in ((3, "H"), (4, "I"), (5, "J"), (7, "L")):
            ws.cell(row=r, column=col,
                    value=f'=SUMIF({BS}!$B:$B,A{r},{BS}!${src}:${src})')
        ws.cell(row=r, column=6, value=f"=IFERROR(D{r}/C{r},0)")
        ws.cell(row=r, column=8, value=f"=IFERROR(E{r}/B{r},0)")
        r += 1
    paint(ws, 4, r - 1, 1, 8, money=(3, 4, 5, 7, 8), pct=(6,))
    widths(ws, [11, 8, 14, 14, 14, 11, 15, 15])

    # ---------------------------------------------------------- Discounts
    ws = wb.create_sheet("Discounts")
    ws["A1"] = "Discounts captured, and discount left on the table"
    ws["A1"].font = TITLE
    band(ws, 3, "1. CAPTURED", 4)
    for i, h in enumerate(["Date", "Bill ref", "Scheme", "Saving (Rs)"], 1):
        ws.cell(row=4, column=i, value=h)
    hdr(ws, 4, 4)
    r = 5
    for b in bills:
        for p in b["promotions"]:
            ws.cell(row=r, column=1,
                    value=datetime.date.fromisoformat(b["date"])
                    ).number_format = "dd-mmm-yyyy"
            ws.cell(row=r, column=2, value=b["ref"])
            label = p["scheme"] or "(unlabelled)"
            if p["code"]:
                label += f" — line {p['line']} / {p['code']}"
            ws.cell(row=r, column=3, value=label)
            ws.cell(row=r, column=4, value=p["amount"])
            r += 1
    cap_end = r - 1
    ws.cell(row=r, column=3, value="TOTAL CAPTURED").font = BOLD
    c = ws.cell(row=r, column=4, value=f"=SUM(D5:D{cap_end})")
    c.font, c.number_format = BOLD, MONEY
    paint(ws, 5, r, 1, 4, money=(4,))
    cap_total_row = r

    r += 2
    band(ws, r, "2. FRESH BOUGHT WITHOUT THE 25% PROMOTION", 6)
    r += 1
    for i, h in enumerate(["Date", "Weekday", "Bill ref", "Fresh base (Rs)",
                           "25% forgone (Rs)", "Paid with"], 1):
        ws.cell(row=r, column=i, value=h)
    hdr(ws, r, 6)
    r += 1
    miss_start = r
    for b in bills:
        if got_fresh_promo(b):
            continue
        fb = fresh_base(b)
        if fb <= 0:
            continue
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(b["date"])
                ).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value=b["weekday"])
        ws.cell(row=r, column=3, value=b["ref"])
        ws.cell(row=r, column=4, value=round(fb, 2)).font = BLUE
        ws.cell(row=r, column=5, value=f"=MIN(D{r}*{FRESH_RATE},{FRESH_CAP})")
        ws.cell(row=r, column=6,
                value=", ".join(t["method"] for t in b["tenders"]))
        r += 1
    miss_end = r - 1
    if miss_end >= miss_start:
        ws.cell(row=r, column=3, value="TOTAL FORGONE").font = BOLD
        for col in (4, 5):
            L = get_column_letter(col)
            c = ws.cell(row=r, column=col,
                        value=f"=SUM({L}{miss_start}:{L}{miss_end})")
            c.font, c.number_format = BOLD, MONEY
            if col == 5:
                c.fill = FLAG_FILL
        paint(ws, miss_start, r, 1, 6, money=(4, 5))
        r += 1
    ws.cell(row=r + 1, column=1, value=(
        "Indicative ceiling, not a target: the promotion has its own terms and "
        "shifting perishables to one day is not always practical.")).font = NOTE
    widths(ws, [14, 10, 11, 18, 20, 46])

    # -------------------------------------------------------- Price Watch
    ws = wb.create_sheet("Price Watch")
    ws["A1"] = "Unit price movement — items bought on more than one trip"
    ws["A1"].font = TITLE
    for i, h in enumerate(["Item", "Item code", "Times", "First", "First price",
                           "Last", "Last price", "Change (Rs)", "Change %"], 1):
        ws.cell(row=3, column=i, value=h)
    hdr(ws, 3, 9)
    sku = defaultdict(list)
    for b in bills:
        for it in b["items"]:
            sku[(it["code"], it["name"])].append((b["date"], it["unit_price"]))
    watch = []
    for (code, name), obs in sku.items():
        if len(obs) < 2:
            continue
        obs.sort()
        watch.append((name, code, len(obs), obs[0][0], obs[0][1],
                      obs[-1][0], obs[-1][1]))
    watch.sort(key=lambda x: -abs((x[6] - x[4]) / x[4]) if x[4] else 0)
    r = 4
    for name, code, n, d1, p1, d2, p2 in watch:
        ws.cell(row=r, column=1, value=name)
        ws.cell(row=r, column=2, value=code)
        ws.cell(row=r, column=3, value=n)
        ws.cell(row=r, column=4,
                value=datetime.date.fromisoformat(d1)).number_format = "dd-mmm"
        ws.cell(row=r, column=5, value=p1).font = BLUE
        ws.cell(row=r, column=6,
                value=datetime.date.fromisoformat(d2)).number_format = "dd-mmm"
        ws.cell(row=r, column=7, value=p2).font = BLUE
        ws.cell(row=r, column=8, value=f"=G{r}-E{r}")
        ws.cell(row=r, column=9, value=f"=IFERROR(H{r}/E{r},0)")
        r += 1
    if r > 4:
        paint(ws, 4, r - 1, 1, 9, money=(5, 7, 8), pct=(9,))
        for rr in range(4, r):
            ws.cell(row=rr, column=5).font = BLUE
            ws.cell(row=rr, column=7).font = BLUE
    widths(ws, [46, 11, 8, 11, 14, 11, 14, 14, 11])
    ws.freeze_panes = "A4"

    # ------------------------------------------------------ Points Ledger
    ws = wb.create_sheet("Points Ledger")
    ws["A1"] = "Loyalty points — reconstructed ledger"
    ws["A1"].font = TITLE
    ws["A2"] = ("Keells bills only. Each prints the balance BEFORE its own points "
                f"post, and the earn rate is a flat {POINTS_RATE:.2%} of net. "
                "A gap means a bill you have not captured, or a bonus credit.")
    ws["A2"].font = NOTE
    for i, h in enumerate(["Date", "Bill ref", "Net (Rs)", "Earned",
                           "Balance printed", "Expected", "Gap",
                           "Implied unseen spend (Rs)"], 1):
        ws.cell(row=4, column=i, value=h)
    hdr(ws, 4, 8)
    keells_bills = [b for b in bills if b.get("source", "keells") == "keells"]
    r = 5
    for i, b in enumerate(keells_bills):
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(b["date"])
                ).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value=b["ref"])
        ws.cell(row=r, column=3, value=f'=SUMIF({BS}!$F:$F,B{r},{BS}!$J:$J)')
        ws.cell(row=r, column=4, value=b["points_earned"]).font = BLUE
        ws.cell(row=r, column=5, value=b["points_balance_printed"]).font = BLUE
        if i == 0:
            ws.cell(row=r, column=6, value="opening")
        else:
            ws.cell(row=r, column=6, value=f"=E{r - 1}+D{r - 1}")
            ws.cell(row=r, column=7, value=f"=E{r}-F{r}")
            ws.cell(row=r, column=8,
                    value=f'=IF(ABS(G{r})<0.05,"",G{r}/{POINTS_RATE})')
        r += 1
    ws.cell(row=r, column=2, value="Balance after latest bill").font = BOLD
    c = ws.cell(row=r, column=5, value=f"=E{r - 1}+D{r - 1}")
    c.font, c.number_format = BOLD, NUM
    paint(ws, 5, r, 1, 8, money=(3, 8), num=(4, 5, 6, 7))

    other = [b for b in bills if b.get("source", "keells") != "keells"]
    if other:
        r += 2
        ws.cell(row=r, column=1, value="OTHER LOYALTY SCHEMES").font = BOLD
        ws.cell(row=r, column=1).fill = SUB_FILL
        r += 1
        for i, h in enumerate(["Date", "Bill ref", "Net (Rs)", "Earned",
                               "Balance printed", "Scheme"], 1):
            ws.cell(row=r, column=i, value=h)
        hdr(ws, r, 6)
        r += 1
        o_start = r
        for b in other:
            ws.cell(row=r, column=1,
                    value=datetime.date.fromisoformat(b["date"])
                    ).number_format = "dd-mmm-yyyy"
            ws.cell(row=r, column=2, value=b["ref"])
            ws.cell(row=r, column=3, value=b["net"])
            ws.cell(row=r, column=4, value=b["points_earned"]).font = BLUE
            ws.cell(row=r, column=5, value=b.get("points_balance_printed")).font = BLUE
            ws.cell(row=r, column=6, value=b.get("loyalty_scheme") or b["source"])
            r += 1
        paint(ws, o_start, r - 1, 1, 6, money=(3,), num=(4, 5))
        r += 1
        ws.cell(row=r, column=1, value=(
            "Separate programme with its own balance and expiry — not part of the "
            "Keells chain above, so it is listed rather than reconciled.")).font = NOTE

    widths(ws, [14, 13, 15, 11, 17, 24, 11, 26])

    # ------------------------------------------------------- Other Stores
    ws = wb.create_sheet("Other Stores")
    ws["A1"] = "Receipts with no e-bill link (entered by hand)"
    ws["A1"].font = TITLE
    ws["A2"] = "Total"
    ws["A2"].font = BOLD
    for i, h in enumerate(["Date", "Store", "Amount (Rs)", "Note"], 1):
        ws.cell(row=4, column=i, value=h)
    hdr(ws, 4, 4)
    r = 5
    for e in manual:
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(e["date"])
                ).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value=e["store"])
        ws.cell(row=r, column=3, value=e["amount"]).font = BLUE
        ws.cell(row=r, column=4, value=e.get("note", ""))
        r += 1
    if r == 5:
        ws.cell(row=5, column=2, value="(none yet)").font = NOTE
        r = 6
    c = ws["B2"] = None
    cell = ws.cell(row=2, column=2, value=f"=SUM(C5:C{max(r - 1, 5)})")
    cell.font, cell.number_format = BOLD, MONEY
    cell.fill = FLAG_FILL
    paint(ws, 5, r - 1, 1, 4, money=(3,))
    widths(ws, [14, 28, 16, 44])

    # --------------------------------------------------- Sources & Method
    ws = wb.create_sheet("Sources & Method")
    ws["A1"] = "Sources and method"
    ws["A1"].font = TITLE
    body = [
        ("SOURCE", True),
        (f"Rebuilt from data/ledger.json on {datetime.date.today():%d-%b-%Y}. "
         f"Ledger holds {len(bills)} Keells e-bills, refs: "
         f"{', '.join(b['ref'] for b in bills)}.", False),
        ("Do not edit this workbook by hand — the next rebuild overwrites it. "
         "Correct the ledger instead.", False),
        ("", False),
        ("VALIDATION", True),
        ("Every bill is checked on load: line items sum to gross, gross less "
         "discount equals net, tenders sum to net, promotion lines sum to the "
         "discount, and points equal 0.34% of net. Failures appear in the "
         "Checks column on the Bills sheet.", False),
        ("", False),
        ("INFERRED, NOT PRINTED ON THE BILLS", True),
        ("1. Categories are assigned by department-code prefix (912-916 veg, "
         "923 fruit, 935 poultry, 941 fish, 951-957 bakery) and keyword rules "
         "for packaged goods. See reference/categories.md.", False),
        ("2. The NTB 25%-off-Fresh promotion pays on fruit, veg and poultry "
         "but NOT fish, is computed after line-level discounts, and is capped "
         "at Rs 1,500 per bill. Derived by matching the bills where it fired.", False),
        ("3. The 0.34% points rate is derived, not stated.", False),
        ("4. Fresh-discount 'forgone' figures are a ceiling, not a forecast.", False),
        ("", False),
        ("DERIVED SHEETS", True),
        ("Scheme Model, Capture Gap, Opportunity and Replenishment are analysis, not "
         "transcription. Each states the number of observations behind it. The scheme "
         "rules are validated on the bills they were derived from — if a validation row "
         "stops reproducing, the rule has changed and the model needs rework before its "
         "conclusions are trusted.", False),
        ("", False),
        ("KNOWN LIMITS", True),
        ("Digibill links expire roughly three months after issue, so bills must "
         "be captured within that window. Raw fetched text is kept under raw/ "
         "as the durable record.", False),
    ]
    r = 3
    for text, is_bold in body:
        cell = ws.cell(row=r, column=1, value=text)
        cell.font = BOLD if is_bold else BASE
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        if is_bold:
            cell.fill = SUB_FILL
        else:
            ws.row_dimensions[r].height = max(15, 15 * (len(text) // 95 + 1))
        r += 1
    widths(ws, [110])

    # ---------------------------------------------------- deep-analysis sheets
    analysis.add_sheets(wb, bills, dict(
        TITLE=TITLE, NOTE=NOTE, BOLD=BOLD, BASE=BASE, BLUE=BLUE,
        MONEY=MONEY, PCT=PCT, NUM=NUM, FLAG_FILL=FLAG_FILL, SUB_FILL=SUB_FILL,
        hdr=hdr, widths=widths, paint=paint, band=band,
    ))

    del wb["Sheet"]
    for s in wb.worksheets:
        s.sheet_view.showGridLines = False
    wb.save(out_path)
    return len(bills), out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default="data/ledger.json")
    ap.add_argument("--out", default="Keells_master.xlsx")
    args = ap.parse_args()
    with open(args.ledger, encoding="utf-8") as fh:
        ledger = json.load(fh)
    n, path = build(ledger, args.out)
    print(f"rebuilt {path} from {n} bills")


if __name__ == "__main__":
    main()
