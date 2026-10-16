#!/usr/bin/env python3
"""Parse a fetched Keells Super e-bill into structured JSON.

Input is the TEXT of the bill page, not a URL. The bill host is not reachable
from the sandbox, so Claude fetches the page with web_fetch and saves the text
first. See SKILL.md.

Usage:
    python3 parse_bill.py raw/AB12CD.md --ref AB12CD > parsed/AB12CD.json
    python3 parse_bill.py raw/*.md --outdir parsed
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime

# --- category rules -------------------------------------------------------
# Department-code prefixes are authoritative for fresh; keywords handle the
# packaged-grocery aisles, which carry no useful code structure.
DEPT_PREFIX = {
    "keells": {
        "912": "Vegetables", "913": "Vegetables", "914": "Vegetables",
        "915": "Vegetables", "916": "Vegetables",
        "923": "Fruit",
        "935": "Meat & fish", "936": "Meat & fish", "941": "Meat & fish",
        "951": "Bakery", "952": "Bakery", "953": "Bakery", "954": "Bakery",
        "955": "Bakery", "956": "Bakery", "957": "Bakery",
    },
    # Glomark runs its own numbering: 310 fresh produce, 350 in-store bakery.
    # Everything else is a 1xxxxx packaged code with no structure, so it falls
    # through to the keyword rules.
    "glomark": {
        "310": "Vegetables", "311": "Fruit", "340": "Meat & fish",
        "350": "Bakery",
    },
}
BAG_CODES = {"77777", "66666", "R1234", "E1234", "116087"}

# Keells dept 916 mixes cooking vegetables (MANGO CURRY) with loose fruit
# (AMBARELLA), so the prefix alone gets it wrong. Exact-name overrides, checked
# before the prefix table. Only add names actually seen on a bill.
NAME_OVERRIDE = {
    "AMBARELLA": "Fruit",
    "PUSSALLA COCKTAIL MIX 350G": "Processed meat",
    # 955xxx is an in-store counter that shares the 95x bakery range but sells
    # fresh juice. One observation, so override the item rather than the prefix.
    "AVOCADO JUICE": "Beverages",
}

# Ordered: first match wins. Word boundaries matter more than they look —
# "CHOCOLATE" contains "COLA", and "CLEANSING MILK" is not dairy, so personal
# care has to be tested before the milk rule.
KEYWORD_RULES = [
    # 1. personal care first: "CLEANSING MILK" and "BABY SOAP" are not food
    ("Household & personal care",
     r"DISH ?WASH|DETERGENT|\bSOAP\b|SHAMPOO|TOOTH|CLEANSING|WRAPPING|TISSUE|"
     r"BLEACH|HAND ?WASH|SANITARY|DIAPER|LOTION|DEODORANT|SERVIETTE|NAPKIN|"
     r"PAPER TOWEL|KITCHEN TOWEL|TOILET|\bCLEAN|\bVIM\b|LYSOL|HARPIC|"
     r"SCOURING|DISINFECT|POLISH|BARBEQUE STICK|BBQ STICK|SKEWER|"
     r"TOOTHPICK|CLING ?(FILM|WRAP)|ALUMINI?UM FOIL|GARBAGE BAG|BIN LINER"),
    # 2. before dairy, so chicken sausage never meets a milk rule
    ("Processed meat",
     r"SAUSAGE|MEAT ?BALL|BACON|\bHAM\b|SALAMI|NUGGET|LINGUS|LINGUICA|"
     r"CHORIZO|\bFRANKFURT|COLD CUT|\bPEPPERONI\b"),
    # 3. tinned fish, before the \bOIL\b staples rule catches "TUNA IN OIL"
    ("Meat & fish",
     r"\bTUNA\b|SARDINE|MACKEREL|SALMON|\bFISH\b|\bPORK\b|\bBEEF\b|"
     r"\bMUTTON\b|\bLAMB\b|\bPRAWN|\bCRAB\b|CUTTLEFISH|\bSQUID\b"),
    # 4. branded packaged bakery that carries no in-store bakery code
    ("Bakery", r"CROISSANT|MUFFIN|DOUGHNUT|DONUT|\bBUN\b|\bBREAD\b|PASTRY|"
               r"\bPIE\b|BAGUETTE"),
    # 5. cheese-flavoured snacks, before the bare \bCHEESE\b dairy rule
    ("Snacks & confectionery",
     r"SNACKS? CHEESE|CHEESE BALL|CHEESE PUFF|CREAM CRACKER|MILK CHOCOLATE"),
    # 6. before dairy: "KOREAN RAMEN CHEESE" is a noodle pack, not cheese
    ("Instant noodles", r"NOODLE|RAMEN|KOTTU MEE"),
    # 7. before dairy: "EGG MAYONNAISE" is a condiment, not an egg
    ("Condiments & spices",
     r"SAUCE|KETCHUP|MAYONN|CHILLI POWDER|CURRY POWDER|CARDAMOM|MUSTARD|"
     r"CINNAMON|TURMERIC|\bSALT\b|VINEGAR|\bJAM\b|ESSENCE|BAKING POWDER|"
     r"FOOD COLOUR|\bYEAST\b|GELATINE"),
    ("Dairy & eggs",
     r"\bMILK\b|\bCHEESE\b|\bCURD\b|\bEGGS?\b|YOGHURT|YOGURT|\bBUTTER\b|"
     r"FULL CREAM|ICE CREAM|\bGHEE\b|MILKMAID|CONDENSED MILK|\bCREAM\b"),
    ("Beverages",
     r"COFFEE|\bTEA\b|\bCOLA\b|JUICE|NECTAR|DRNK|DRINK|\bSODA\b|MINERAL WATER|"
     r"ENERGY|TETRA|\bPET\b|CAN \d|\bKIST\b|AGGLOMERATED|NESCAFE|MILO|HORLICKS"),
    ("Snacks & confectionery",
     r"BISCUIT|CHOC|POP ?CORN|PEANUT|CHIPS|CRISP|\bCAKE\b|SNACK|WAFER|CANDY|"
     r"CRACKER|\bNUTS?\b|\bMIXTURE\b|MURUKKU|\bBITES\b|\bSEV\b|KISSES|"
     r"TOFFEE|MARSHMALLOW|LOLLI"),
    ("Staples & grocery",
     r"\bRICE\b|FLOUR|SUGAR|\bOIL\b|PARATHA|SAMAPOSHA|DHAL|PASTA|LENTIL|"
     r"COCONUT|CEREAL|OATS|\bSPREAD\b|SEMOLINA|\bRAVA\b|FRENCH FRIES|"
     r"HASH BROWN|\bATTA\b"),
]

# Departments the NTB "25% off on Fresh" promotion pays out on.
# Derived by matching the three bills where it fired; fish (941) is excluded.
FRESH_PREFIX = {"912", "913", "914", "915", "916", "923", "935"}
FRESH_CAP = 1500.00
FRESH_RATE = 0.25
POINTS_RATE = 0.0034  # points per rupee of net; holds exactly on every bill seen


def categorise(code: str, name: str, source: str = "keells") -> str:
    if code in BAG_CODES or re.search(r"POLYTHENE BAG|KEELLS BAG|\bLLDP\b|SHOPPING BAG",
                                      name, re.I):
        return "Bags"
    override = NAME_OVERRIDE.get(name.strip().upper())
    if override:
        return override
    table = DEPT_PREFIX.get(source, DEPT_PREFIX["keells"])
    pref = code[:3]
    if pref in table:
        return table[pref]
    for cat, pattern in KEYWORD_RULES:
        if re.search(pattern, name, re.I):
            return cat
    return "Other grocery"


# --------------------------------------------------------------- subcategories
# A second level under `category`, to show what is actually driving a category.
# Rules are (regex, subcategory) checked in order WITHIN a category, so a pattern
# only has to be unambiguous among that category's own items. The last entry of
# each list is the catch-all.
SUBCATEGORY_RULES = {
    "Dairy & eggs": [
        (r"MILK POWDER|FULL CREAM MILK POWDER", "Milk powder"),
        (r"MILKMAID|CONDENSED", "Condensed milk"),
        (r"ICE CREAM", "Ice cream"),
        (r"\bBUTTER\b", "Butter"),
        (r"YOGHURT|YOGURT|\bCURD\b", "Yoghurt & curd"),
        (r"CHEESE", "Cheese"),
        (r"\bEGGS?\b", "Eggs"),
        (r"FLAV MILK|CHOCOLATE MILK DRINK|CHOCO TETRA", "Flavoured milk"),
        (r"UHT|U H T|PASTEURIZED|FRESH MILK", "Liquid milk"),
        (r".", "Other dairy"),
    ],
    "Meat & fish": [
        (r"TUNA|SARDINE|MACKEREL|SALMON", "Tinned fish"),
        (r"THALAPATH|\bFISH\b|PRAWN|CRAB|SQUID", "Fresh fish"),
        (r"BREAST", "Chicken - breast"),
        (r"LEGS|THIGH|DRUMSTICK", "Chicken - legs"),
        (r"CHICKEN", "Chicken - other"),
        (r".", "Other meat"),
    ],
    "Staples & grocery": [
        (r"\bRICE\b", "Rice"),
        (r"\bOIL\b", "Cooking oil"),
        (r"FLOUR|SEMOLINA|\bRAVA\b", "Flour & semolina"),
        (r"PARATHA|\bROTI\b", "Flatbread"),
        (r"FRENCH FRIES|HASH BROWN", "Frozen potato"),
        (r"SUGAR", "Sugar"),
        (r"DHAL|LENTIL|\bGRAM\b", "Pulses"),
        (r"SAMAPOSHA|CEREAL|OATS", "Cereal"),
        (r".", "Other staples"),
    ],
    "Beverages": [
        (r"COFFEE|AGGLOMERATED|NESCAFE", "Coffee"),
        (r"\bTEA\b", "Tea"),
        (r"\bCOLA\b", "Carbonated soft drinks"),
        (r"KIST RIDE|NRG|ENERGY|CAFF|SPINNER", "Energy & functional drinks"),
        (r"JUICE|NECTAR", "Juice & nectar"),
        (r".", "Other drinks"),
    ],
    "Vegetables": [
        (r"ONION|GARLIC|LEEKS", "Alliums"),
        (r"MUSHROO", "Mushrooms"),
        (r"POTATO|BEETROOT|CARROT|\bALA\b", "Roots & tubers"),
        (r"GOTUKOLA|KANKUN|SALAD LEAVES|CABBAGE|CORIANDER|\bLEAVES\b", "Leafy greens"),
        (r"CHILI|GINGER|\bLIME\b", "Aromatics"),
        (r"COCONUT", "Coconut"),
        (r".", "Fruiting vegetables"),
    ],
    "Household & personal care": [
        (r"DISH ?WASH|DETERGENT|LYSOL|\bVIM\b|TEEPOL|CLEAN|BLEACH", "Cleaning"),
        (r"SERVIETTE|NAPKIN|WRAPPING|BARBEQUE STICK|TOWEL|TISSUE", "Paper & disposables"),
        (r".", "Personal care"),
    ],
    "Bakery": [
        (r"SAMOSA|\bPIE\b|CHICKEN BUN|SAUSAGE ROLL", "Savoury baked"),
        (r"CROISSANT|DOUGHNUT|DONUT|MUFFIN|PASTRY", "Sweet pastry"),
        (r"\bBREAD\b", "Bread"),
        (r"\bBUN\b", "Buns"),
        (r".", "Other bakery"),
    ],
    "Processed meat": [
        (r"MEAT ?BALL|NUGGET", "Meatballs & nuggets"),
        (r".", "Sausages & cold cuts"),
    ],
    "Condiments & spices": [
        (r"MAYONN|MUSTARD CREAM|DRESSING", "Mayonnaise & dressings"),
        (r"SAUCE|KETCHUP", "Sauces"),
        (r"ESSENCE|BAKING POWDER|FOOD COLOUR", "Baking flavours"),
        (r".", "Spices"),
    ],
    "Snacks & confectionery": [
        (r"BISCUIT|CRACKER|\bCAKE\b|WAFER", "Biscuits & cake"),
        (r"CHOC|KISSES|TOFFEE|CANDY", "Chocolate & sweets"),
        (r".", "Savoury snacks"),
    ],
    "Fruit": [
        (r"MANGO(?!STEEN)", "Mango"),
        (r"MELON", "Melon"),
        (r"DRAGON|MANGOSTEEN", "Exotic fruit"),
        (r".", "Local fruit"),
    ],
    "Instant noodles": [
        (r"MAGGI", "Maggi"),
        (r"PRIMA", "Prima"),
        (r".", "Other noodles"),
    ],
    "Bags": [
        (r"RE-USE|REFUND|REUSABLE", "Reusable bag"),
        (r".", "Polythene bags"),
    ],
}


def subcategorise(category, name):
    for pattern, sub in SUBCATEGORY_RULES.get(category, []):
        if re.search(pattern, name, re.I):
            return sub
    return category


def is_fresh_eligible(code: str, source: str = "keells") -> bool:
    """Only meaningful for Keells: the 25%-off-Fresh promo is a Keells scheme."""
    return source == "keells" and code[:3] in FRESH_PREFIX


def num(s: str) -> float:
    return float(s.replace(",", "").strip())


ITEM_RE = re.compile(
    r"^\|\s*(\d+)\s*\|\s*([A-Za-z0-9]+):\s*(.+?)\s*\|\s*([\d,]+\.\d{2})\s*\|"
    r"\s*(-?[\d.]+)\s*\|\s*(-?[\d,]+\.\d{2})\s*\|"
)
HEADER_RE = re.compile(r"(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2}:\d{2})"
                       r"(?:\s+C:(\d+))?(?:\s+R:(\d+))?")
STORECODE_RE = re.compile(r"Store Code:\s*([A-Z0-9]+)")
# summary values appear either as "- Gross Amount 4,367.56" or in a table row
SUMMARY_RE = {
    "gross": re.compile(r"Gross Amount[^\d\-]*([\d,]+\.\d{2})"),
    "discount": re.compile(r"Promotion Discount[^\d\-]*([\d,]+\.\d{2})"),
    "net": re.compile(r"Net Amount[^\d\-]*([\d,]+\.\d{2})"),
}
POINTS_RE = re.compile(r"Points earned for this bill:\s*([\d,]+\.\d+)")
BALANCE_RE = re.compile(r"Total points redeemable as at\s+\d{2}-[A-Za-z]{3}-\d{4}\s+([\d,]+\.\d+)")
TRAILING_AMOUNT_RE = re.compile(r"^(.*?)\s+(-?[\d,]+\.\d{2})$")
LINE_PROMO_RE = re.compile(r"^(\d+)\s+([A-Za-z0-9]+)\s+(?:([\d.]+)%\s+)?"
                           r"(?:Value\s+)?Dis$", re.I)

STORE_NAMES = {
    "SCK3": "Kottawa", "SCME": "Mattegoda", "SIAL": "Aluthgama",
}

# summary rows already captured elsewhere; never treat these as tender or promo
SKIP_LABELS = re.compile(
    r"Gross Amount|Promotion Discount|Net Amount|Total promotion\(s\) savings|"
    r"Points earned|Total points redeemable", re.I)
# a payment instrument, not a discount scheme.
# NB the bill misspells RewardzPay as "RewadzPay" on Seylan lines.
TENDER_HINT = re.compile(
    r"Credit Card|Debit Card|\bCash\b|Rew[a-z]*Pay|Voucher|Gift Card|"
    r"\bLoyalty\b|Bank\s*-", re.I)


def _normalise_summary_lines(lines):
    """Flatten both summary layouts into plain 'label value' strings.

    Keells renders the totals block either as markdown bullets
    ('- Net Amount 1,370.00') or as a wide table row
    ('| Net Amount | | | | | | 1,370.00 |'). Normalising first means the
    classifier below only has to handle one shape.
    """
    out = []
    for raw in lines:
        s = raw.strip()
        if not s or set(s) <= set("|- "):
            continue
        if s.startswith("|") and s.endswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            cells = [c for c in cells if c]
            if len(cells) == 2:
                out.append(f"{cells[0]} {cells[1]}")
            continue
        out.append(s.lstrip("-").strip())
    return out


def parse(text: str, ref: str) -> dict:
    lines = [l.rstrip() for l in text.splitlines()]

    m = HEADER_RE.search(text)
    if not m:
        raise ValueError(f"{ref}: could not find the date/time header line")
    date = datetime.strptime(m.group(1), "%d-%b-%Y").date()

    sc = STORECODE_RE.search(text)
    store_code = sc.group(1) if sc else "UNKNOWN"

    items = []
    for line in lines:
        im = ITEM_RE.match(line)
        if not im:
            continue
        _, code, name, price, qty, amount = im.groups()
        name = re.sub(r"\s+", " ", name).strip()
        items.append(dict(
            code=code, name=name,
            unit_price=num(price), qty=float(qty), amount=num(amount),
            category=categorise(code, name),
            subcategory=subcategorise(categorise(code, name), name),
            fresh_eligible=is_fresh_eligible(code),
        ))
    if not items:
        raise ValueError(f"{ref}: no item lines matched")

    def summary(key, default=0.0):
        mm = SUMMARY_RE[key].search(text)
        return num(mm.group(1)) if mm else default

    gross = summary("gross")
    discount = summary("discount", 0.0)
    net = summary("net")

    # The block below the items table mixes summary rows, payment tenders,
    # bill-level promotions, bare scheme headings and line-level discounts.
    # Walk it once, carrying the most recent heading forward.
    tenders, promos = [], []
    heading = None
    for s in _normalise_summary_lines(lines):
        if SKIP_LABELS.search(s):
            continue
        am = TRAILING_AMOUNT_RE.match(s)
        if not am:
            # no amount => it is a scheme heading for the lines that follow
            if re.search(r"Deal|Nexus|Quick|Discount|off on|%", s, re.I):
                heading = s
            continue
        label, amount = am.group(1).strip(), num(am.group(2))
        lp = LINE_PROMO_RE.match(label)
        if lp:
            promos.append(dict(scheme=heading, line=int(lp.group(1)), code=lp.group(2),
                               pct=float(lp.group(3)) if lp.group(3) else None,
                               amount=amount))
        elif TENDER_HINT.search(label):
            tenders.append(dict(method=label, amount=amount))
        else:
            # a bill-level promotion such as "NTB | 25% off on Fresh 713.00";
            # it also heads any line discounts printed beneath it
            promos.append(dict(scheme=label, line=None, code=None,
                               pct=None, amount=amount))
            heading = label

    pm = POINTS_RE.search(text)
    bm = BALANCE_RE.search(text)

    bill = dict(
        ref=ref,
        source="keells",
        date=date.isoformat(),
        weekday=date.strftime("%a"),
        time=m.group(2)[:5],
        store_code=store_code,
        store=STORE_NAMES.get(store_code, store_code),
        gross=gross, discount=discount, net=net,
        points_earned=num(pm.group(1)) if pm else 0.0,
        points_balance_printed=num(bm.group(1)) if bm else None,
        tenders=tenders, promotions=promos, items=items,
    )
    bill["checks"] = run_checks(bill)
    return bill


def run_checks(b: dict) -> dict:
    item_sum = round(sum(i["amount"] for i in b["items"]), 2)
    tender_sum = round(sum(t["amount"] for t in b["tenders"]), 2)
    promo_sum = round(sum(p["amount"] for p in b["promotions"]), 2)
    return {
        "items_equal_gross": abs(item_sum - b["gross"]) < 0.02,
        "gross_less_discount_equals_net": abs((b["gross"] - b["discount"]) - b["net"]) < 0.02,
        "tenders_equal_net": abs(tender_sum - b["net"]) < 0.02,
        "promo_lines_equal_discount": abs(promo_sum - b["discount"]) < 0.02,
        "points_match_rate": abs(b["points_earned"] - b["net"] * POINTS_RATE) < 0.02,
        "item_sum": item_sum, "tender_sum": tender_sum, "promo_sum": promo_sum,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--ref", help="bill reference (single file only)")
    ap.add_argument("--outdir")
    args = ap.parse_args()

    out = []
    for path in args.files:
        ref = args.ref or os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as fh:
            bill = parse(fh.read(), ref)
        failed = [k for k, v in bill["checks"].items()
                  if isinstance(v, bool) and not v]
        if failed:
            print(f"WARNING {ref}: failed {', '.join(failed)}", file=sys.stderr)
        if args.outdir:
            os.makedirs(args.outdir, exist_ok=True)
            with open(os.path.join(args.outdir, f"{ref}.json"), "w") as fh:
                json.dump(bill, fh, indent=2)
            print(f"{ref}: {len(bill['items'])} lines, net {bill['net']:,.2f}"
                  f"{'  [CHECK FAILED]' if failed else ''}", file=sys.stderr)
        else:
            out.append(bill)
    if out:
        print(json.dumps(out[0] if len(out) == 1 else out, indent=2))


if __name__ == "__main__":
    main()
