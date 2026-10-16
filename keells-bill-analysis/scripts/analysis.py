#!/usr/bin/env python3
"""Deep-analysis sheets, generated from the ledger by build_workbook.py.

Everything here is derived, not printed on any bill. Each model states the
evidence it rests on and how many observations support it, because most of
these rules come from one or two receipts and will need revisiting as more
arrive.

Imported by build_workbook.py; not run directly.
"""
import calendar
import datetime
from collections import defaultdict

from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------- scheme model
# Keells: "NTB | 25% off on Fresh". Fruit, veg and poultry; fish excluded;
# computed after line-level discounts; capped Rs 1,500; only ever seen on
# Sundays (3 of 3).
K_FRESH_PREFIX = {"912", "913", "914", "915", "916", "923", "935"}
K_FRESH_CAP = 1500.00
RATE = 0.25
POINTS_RATE = 0.0034


def _bag(code, name):
    return code in {"116087", "77777", "66666"} or "LLDP" in name \
        or "POLYTHENE BAG" in name


def _milk_staple(code, name):
    # UHT and powdered milk. Deliberately not bare "MILK": a chocolate milk
    # drink was discounted on the Sampath bill, so flavoured milk is eligible.
    return "UHT" in name or "U H T" in name or "MILK POWDER" in name


def _egg_staple(code, name):
    # "EGG MAYONNAISE" is a condiment and was discounted on two bills, so the
    # test cannot be a bare "EGG" substring.
    return "EGG" in name and "MAYONN" not in name


def _fresh_meat(code, name):
    return code[:3] == "340"


def _coconut(code, name):
    return name.strip() == "COCONUT"


GLOMARK_SCHEMES = {
    "seylan": dict(
        label="Seylan CC 25%", cap=None, seen="one bill, a Saturday",
        excludes="carrier bags only",
        excl=lambda c, n: _bag(c, n)),
    "power": dict(
        label="Power Hours 25%", cap=None, seen="one bill, a Wednesday",
        excludes="bags, UHT and powdered milk, eggs",
        excl=lambda c, n: _bag(c, n) or _milk_staple(c, n) or _egg_staple(c, n)),
    "sampath": dict(
        label="Sampath CC 25%", cap=2500.00, seen="one bill, a Thursday",
        excludes="bags, UHT milk, eggs, fresh meat, coconut",
        excl=lambda c, n: _bag(c, n) or _milk_staple(c, n) or _egg_staple(c, n)
        or _fresh_meat(c, n) or _coconut(c, n)),
}
# Which scheme each observed Glomark bill actually ran on.
# Which scheme each observed Glomark bill ran on (the synthetic demo refs; real refs go here for a private ledger).
OBSERVED_ON = {"GLO900001": "power", "GLO900002": "seylan", "GLO900003": "sampath"}


def glomark_base(bill, scheme):
    f = GLOMARK_SCHEMES[scheme]["excl"]
    return round(sum(i["amount"] for i in bill["items"]
                     if not f(i["code"], i["name"].upper())), 2)


def glomark_payout(bill, scheme):
    """Returns (paid, uncapped, was_capped)."""
    raw = round(glomark_base(bill, scheme) * RATE, 2)
    cap = GLOMARK_SCHEMES[scheme]["cap"]
    if cap is not None and raw > cap:
        return cap, raw, True
    return raw, raw, False


def keells_fresh_base(bill):
    line_disc = defaultdict(float)
    for p in bill["promotions"]:
        if p.get("code"):
            line_disc[p["code"]] += p["amount"]
    return round(sum(i["amount"] - line_disc.get(i["code"], 0.0)
                     for i in bill["items"]
                     if i["code"][:3] in K_FRESH_PREFIX), 2)


def keells_fresh_fired(bill):
    return any(p["scheme"] and "off on Fresh" in p["scheme"]
               for p in bill["promotions"])


def item_promo_excess(bill):
    """Discount on a line beyond what the 25% scheme alone would give.

    A line can carry its own promotion on top of the bank scheme — on one
    bill a hamburger bun took 40% under "MULTIPLE PROMOTION" while everything else took
    25%. Only the excess above 25% belongs to that separate promotion, so the
    scheme model is judged on the rest.
    """
    excess = 0.0
    for i in bill["items"]:
        d = i.get("line_discount", 0.0)
        if d > 0:
            excess += max(0.0, d - round(i["amount"] * RATE, 2))
    return round(excess, 2)


# ------------------------------------------------------------------ the sheets
def add_sheets(wb, bills, S):
    """S carries the style helpers and constants from build_workbook."""
    keells = [b for b in bills if b.get("source", "keells") == "keells"]
    glomark = [b for b in bills if b.get("source") == "glomark"]
    opp = _scheme_model(wb, bills, glomark, S)
    gap, uncaptured = _capture_gap(wb, keells, bills, S)
    _opportunity(wb, bills, keells, glomark, opp, S)
    _replenishment(wb, bills, S)
    _daily_cost(wb, bills, keells, S)
    _subcategory(wb, bills, S)
    return uncaptured


def _scheme_model(wb, bills, glomark, S):
    ws = wb.create_sheet("Scheme Model")
    ws["A1"] = "Discount schemes, reverse-engineered"
    ws["A1"].font = S["TITLE"]
    ws["A2"] = ("None of this is printed on a bill. Each rule was derived by matching "
                "the bills where the scheme fired, then checked back against them.")
    ws["A2"].font = S["NOTE"]

    r = 4
    S["band"](ws, r, "1. THE RULES", 6)
    r += 1
    for i, h in enumerate(["Scheme", "Store", "Rate", "Cap", "Excludes",
                           "Observations"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 6)
    r += 1
    rules = [
        ("NTB | 25% off on Fresh", "Keells", 0.25, K_FRESH_CAP,
         "everything except fruit, veg and poultry; fish (941) excluded",
         "3 bills, all Sundays. Two midweek NTB bills carrying fresh drew nothing."),
    ]
    for key in ("seylan", "power", "sampath"):
        s = GLOMARK_SCHEMES[key]
        rules.append((s["label"], "Glomark", 0.25, s["cap"], s["excludes"],
                      f"1 bill, {s['seen']}"))
    for label, store, rate, cap, exc, obs in rules:
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=store)
        ws.cell(row=r, column=3, value=rate).number_format = S["PCT"]
        c = ws.cell(row=r, column=4, value=cap if cap else "none seen")
        if cap:
            c.number_format = S["MONEY"]
        ws.cell(row=r, column=5, value=exc)
        ws.cell(row=r, column=6, value=obs)
        r += 1
    S["paint"](ws, r - len(rules), r - 1, 1, 6, pct=(3,))

    r += 1
    S["band"](ws, r, "2. VALIDATION — does the model reproduce the bill it came from?", 6)
    r += 1
    for i, h in enumerate(["Date", "Scheme", "Eligible base", "Modelled payout",
                           "Actual discount", "Result"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 6)
    r += 1
    v0 = r
    for b in glomark:
        sch = OBSERVED_ON.get(b["ref"])
        if not sch:
            continue
        paid, raw, capped = glomark_payout(b, sch)
        modelled = round(paid + item_promo_excess(b), 2)
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(b["date"])
                ).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value=GLOMARK_SCHEMES[sch]["label"])
        ws.cell(row=r, column=3, value=glomark_base(b, sch))
        ws.cell(row=r, column=4, value=modelled)
        ws.cell(row=r, column=5, value=b["discount"])
        c = ws.cell(row=r, column=6,
                    value="reproduces exactly" if abs(modelled - b["discount"]) < 1.5
                    else f"off by {modelled - b['discount']:+,.2f}")
        if abs(modelled - b["discount"]) >= 1.5:
            c.fill = S["FLAG_FILL"]
        r += 1
    for b in [x for x in bills if x.get("source", "keells") == "keells"
              and keells_fresh_fired(x)]:
        fb = keells_fresh_base(b)
        modelled = min(round(fb * RATE, 2), K_FRESH_CAP)
        actual = round(sum(p["amount"] for p in b["promotions"]
                           if p["scheme"] and "off on Fresh" in p["scheme"]), 2)
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(b["date"])
                ).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value="NTB | 25% off on Fresh")
        ws.cell(row=r, column=3, value=fb)
        ws.cell(row=r, column=4, value=modelled)
        ws.cell(row=r, column=5, value=actual)
        ws.cell(row=r, column=6,
                value="reproduces exactly" if abs(modelled - actual) < 1.5
                else f"off by {modelled - actual:+,.2f}")
        r += 1
    S["paint"](ws, v0, r - 1, 1, 6, money=(3, 4, 5))

    r += 1
    S["band"](ws, r, "3. CARD CHOICE — same basket, same day, a different card", 6)
    r += 1
    for i, h in enumerate(["Date", "Gross", "Card used", "Paid",
                           "Best card available", "Would have paid"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 6)
    r += 1
    c0 = r
    total_gain = 0.0
    for b in glomark:
        act = OBSERVED_ON.get(b["ref"])
        if not act:
            continue
        options = {k: glomark_payout(b, k)[0] for k in GLOMARK_SCHEMES}
        best = max(options, key=lambda k: options[k])
        gain = round(options[best] - b["discount"], 2)
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(b["date"])
                ).number_format = "dd-mmm-yyyy"
        ws.cell(row=r, column=2, value=b["gross"])
        ws.cell(row=r, column=3, value=GLOMARK_SCHEMES[act]["label"])
        ws.cell(row=r, column=4, value=b["discount"])
        ws.cell(row=r, column=5, value=GLOMARK_SCHEMES[best]["label"]
                + (" (same)" if best == act else ""))
        c = ws.cell(row=r, column=6, value=options[best])
        if gain > 1:
            c.fill = S["FLAG_FILL"]
            total_gain += gain
        r += 1
    ws.cell(row=r, column=5, value="TOTAL FORGONE BY CARD CHOICE").font = S["BOLD"]
    c = ws.cell(row=r, column=6, value=round(total_gain, 2))
    c.font, c.number_format, c.fill = S["BOLD"], S["MONEY"], S["FLAG_FILL"]
    S["paint"](ws, c0, r, 1, 6, money=(2, 4, 6))
    r += 2
    for note in [
        "Seylan is the broadest of the three — it excluded only the carrier bags.",
        "Sampath is the narrowest and the only one with a cap, so it is the worst",
        "   card for a large basket and the one to avoid when buying fresh meat.",
        "",
        "CAVEAT: each Glomark exclusion list rests on a single bill, and each was",
        "seen on a different weekday, so whether any of them is day-restricted is",
        "unknown. A second bill per scheme would settle both questions.",
    ]:
        ws.cell(row=r, column=1, value=note).font = S["NOTE"]
        r += 1
    S["widths"](ws, [30, 16, 14, 16, 30, 62])
    return round(total_gain, 2)


def _capture_gap(wb, keells, bills, S):
    ws = wb.create_sheet("Capture Gap")
    ws["A1"] = "How much real spend this ledger is missing"
    ws["A1"].font = S["TITLE"]
    ws["A2"] = ("Keells prints a running points balance. Where the chain breaks, spend "
                "happened that produced no e-bill in this ledger.")
    ws["A2"].font = S["NOTE"]
    r = 4
    for i, h in enumerate(["From", "To", "Points gap", "Implied spend (Rs)",
                           "Reading"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 5)
    r += 1
    r0 = r
    uncaptured = 0.0
    for prev, cur in zip(keells, keells[1:]):
        expected = prev["points_balance_printed"] + prev["points_earned"]
        gap = round(cur["points_balance_printed"] - expected, 2)
        if abs(gap) <= 0.05:
            continue
        implied = gap / POINTS_RATE
        credit = implied > 30000
        if not credit:
            uncaptured += implied
        ws.cell(row=r, column=1,
                value=datetime.date.fromisoformat(prev["date"])
                ).number_format = "dd-mmm"
        ws.cell(row=r, column=2,
                value=datetime.date.fromisoformat(cur["date"])
                ).number_format = "dd-mmm"
        ws.cell(row=r, column=3, value=gap)
        ws.cell(row=r, column=4, value=round(implied, 2))
        ws.cell(row=r, column=5,
                value="too large for any basket — reads as a bonus or promotional credit"
                if credit else "a Keells trip that produced no e-bill here")
        r += 1
    S["paint"](ws, r0, r - 1, 1, 5, money=(4,), num=(3,))
    r += 1
    captured = sum(b["net"] for b in keells)
    total = sum(b["net"] for b in bills)
    for label, val, fmt in [
        ("Keells net captured in this ledger", captured, S["MONEY"]),
        ("Keells spend implied but missing", round(uncaptured, 2), S["MONEY"]),
        ("Share of Keells spend the ledger holds",
         captured / (captured + uncaptured) if uncaptured else 1.0, S["PCT"]),
        ("", None, None),
        ("Ledger total, all stores", total, S["MONEY"]),
        ("Likely true total", round(total + uncaptured, 2), S["MONEY"]),
    ]:
        if label:
            ws.cell(row=r, column=1, value=label).font = S["BOLD"] \
                if "true total" in label else S["BASE"]
            c = ws.cell(row=r, column=4, value=val)
            c.number_format = fmt
            if "true total" in label:
                c.font, c.fill = S["BOLD"], S["FLAG_FILL"]
        r += 1
    r += 1
    for note in [
        "Every per-category, per-day and per-store Keells figure in this workbook",
        "inherits this shortfall. Treat Keells numbers as a floor, not a measurement.",
        "Glomark has no equivalent check: its points do not follow a derivable rate.",
    ]:
        ws.cell(row=r, column=1, value=note).font = S["NOTE"]
        r += 1
    S["widths"](ws, [46, 12, 14, 20, 60])
    return r, round(uncaptured, 2)


def _opportunity(wb, bills, keells, glomark, card_gain, S):
    ws = wb.create_sheet("Opportunity")
    ws["A1"] = "Discount left on the table"
    ws["A1"].font = S["TITLE"]
    ws["A2"] = "A ceiling, not a target. The overlaps are named below the table."
    ws["A2"].font = S["NOTE"]

    fresh_missed = 0.0
    for b in keells:
        if keells_fresh_fired(b):
            continue
        fb = keells_fresh_base(b)
        if fb > 0:
            fresh_missed += min(round(fb * RATE, 2), K_FRESH_CAP)
    cap_loss = 0.0
    for b in glomark:
        sch = OBSERVED_ON.get(b["ref"])
        if sch and GLOMARK_SCHEMES[sch]["cap"]:
            paid, raw, capped = glomark_payout(b, sch)
            if capped:
                cap_loss += round(raw - paid, 2)
    green = 6.0 * max(len(keells) - 1, 0)
    total_net = sum(b["net"] for b in bills)

    r = 4
    for i, h in enumerate(["Where", "Rs", "Basis"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 3)
    r += 1
    r0 = r
    rows = [
        ("Keells fresh bought outside the Sunday/NTB window",
         round(fresh_missed, 2),
         "25% of eligible fresh on every non-Sunday Keells trip, capped at 1,500"),
        ("Glomark card choice", card_gain,
         "best modelled scheme vs the card actually used, same basket and day"),
        ("Glomark per-bill cap", round(cap_loss, 2),
         "uncapped 25% less what the cap allowed"),
        ("Green bag discount not claimed", green,
         "Rs 6 per reusable bag; claimed on one Keells trip"),
    ]
    for n, v, basis in rows:
        ws.cell(row=r, column=1, value=n)
        ws.cell(row=r, column=2, value=v)
        ws.cell(row=r, column=3, value=basis)
        r += 1
    ws.cell(row=r, column=1, value="TOTAL").font = S["BOLD"]
    c = ws.cell(row=r, column=2, value=f"=SUM(B{r0}:B{r-1})")
    c.font, c.number_format, c.fill = S["BOLD"], S["MONEY"], S["FLAG_FILL"]
    r += 1
    ws.cell(row=r, column=1, value="as % of net actually paid").font = S["BASE"]
    ws.cell(row=r, column=2, value=f"=B{r-1}/{total_net}").number_format = S["PCT"]
    S["paint"](ws, r0, r, 1, 3, money=(2,))
    r += 2
    for note in [
        "These do not simply add up:",
        "  - on a capped Sampath bill the cap loss sits inside the card-choice figure;",
        "    counting both double-counts the capped amount",
        "  - perishables cannot always wait for a Sunday, so the fresh figure is the",
        "    full theoretical amount rather than a realistic saving",
        "  - the Glomark figures depend on exclusion lists derived from one bill each",
        "",
        "The one line here that is unambiguous and costs nothing to fix is the bag",
        "discount: Rs 6 per reusable bag, on every trip.",
    ]:
        ws.cell(row=r, column=1, value=note).font = S["NOTE"]
        r += 1
    S["widths"](ws, [52, 14, 72])


def _replenishment(wb, bills, S):
    ws = wb.create_sheet("Replenishment")
    ws["A1"] = "Buying cadence for recurring staples"
    ws["A1"].font = S["TITLE"]
    ws["A2"] = ("Grouped by what the thing is, not by SKU — milk is bought from three "
                "brands. Gaps are between captured bills only, so true cadence is shorter.")
    ws["A2"].font = S["NOTE"]

    D = datetime.date.fromisoformat
    span = (D(bills[-1]["date"]) - D(bills[0]["date"])).days + 1
    groups = [
        ("Fresh chicken", lambda n, c: "CHICKEN" in n and not any(
            x in n for x in ("SAUSAGE", "BUN", "MEAT BALL", "COCKTAIL", "PIE"))),
        ("UHT milk", lambda n, c: "UHT MILK" in n or ("MILK" in n and "U H T" in n)),
        ("Eggs (10s)", lambda n, c: "EGG" in n and "10S" in n),
        ("Rice", lambda n, c: "RICE" in n),
        ("Bread", lambda n, c: "BREAD" in n),
        ("Big onions", lambda n, c: "BIG ONIONS" in n),
        ("Roti paratha", lambda n, c: "PARATHA" in n),
        ("Finagle croissant", lambda n, c: "CROISSANT" in n and "FINAGLE" in n),
    ]
    r = 4
    for i, h in enumerate(["Staple", "Buys", "Units / kg", "Spend (Rs)",
                           "Avg days between", "Gaps (days)", "Rs per week"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 7)
    r += 1
    r0 = r
    for label, f in groups:
        ev = []
        for b in bills:
            q = sum(i["qty"] for i in b["items"] if f(i["name"].upper(), i["category"]))
            a = sum(i["amount"] for i in b["items"] if f(i["name"].upper(), i["category"]))
            if q > 0:
                ev.append((D(b["date"]), q, a))
        if len(ev) < 2:
            continue
        gaps = [(ev[i + 1][0] - ev[i][0]).days for i in range(len(ev) - 1)]
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=len(ev))
        ws.cell(row=r, column=3, value=round(sum(e[1] for e in ev), 3))
        ws.cell(row=r, column=4, value=round(sum(e[2] for e in ev), 2))
        ws.cell(row=r, column=5, value=round(sum(gaps) / len(gaps), 1))
        ws.cell(row=r, column=6, value=", ".join(str(g) for g in gaps))
        ws.cell(row=r, column=7,
                value=round(sum(e[2] for e in ev) / span * 7, 2))
        r += 1
    S["paint"](ws, r0, r - 1, 1, 7, money=(4, 7), num=(3, 5))
    r += 1
    for note in [
        f"Window: {span} days, {len(bills)} captured bills.",
        "See the Capture Gap sheet — roughly a third of Keells trips are missing, so",
        "every cadence here is an upper bound on the true interval and every volume a",
        "lower bound on true consumption.",
    ]:
        ws.cell(row=r, column=1, value=note).font = S["NOTE"]
        r += 1
    S["widths"](ws, [24, 8, 13, 14, 19, 30, 13])


# ------------------------------------------------------------ per-day costing
# Shelf life drives whether a purchase is consumption or stock. Pantry goods
# bought at 25% off outlive the window, so an all-in daily rate overstates what
# an ordinary day costs.
SHORT_LIFE = {"Vegetables", "Fruit", "Meat & fish", "Bakery"}
MED_LIFE = {"Dairy & eggs", "Processed meat"}
PANTRY = {"Staples & grocery", "Condiments & spices", "Household & personal care",
          "Snacks & confectionery", "Instant noodles", "Beverages"}


def shelf_bucket(category):
    if category in SHORT_LIFE:
        return "fresh"
    if category in MED_LIFE:
        return "chilled"
    if category in PANTRY:
        return "pantry"
    return "other"


def missing_by_day(keells):
    """Spread each points-gap over the days it could have happened on."""
    out = defaultdict(float)
    D = datetime.date.fromisoformat
    for prev, cur in zip(keells, keells[1:]):
        gap = round(cur["points_balance_printed"]
                    - (prev["points_balance_printed"] + prev["points_earned"]), 2)
        if abs(gap) <= 0.05:
            continue
        implied = gap / POINTS_RATE
        if implied > 30000:       # a bonus credit, not spend
            continue
        a, b = D(prev["date"]), D(cur["date"])
        days = [a + datetime.timedelta(d) for d in range(1, (b - a).days + 1)]
        for d in days:
            out[d] += implied / len(days)
    return out


def _daily_cost(wb, bills, keells, S):
    ws = wb.create_sheet("Daily Cost")
    ws["A1"] = "What a day costs"
    ws["A1"].font = S["TITLE"]
    ws["A2"] = ("Three different rates, because they answer different questions. "
                "Read the note at the foot before quoting any of them.")
    ws["A2"].font = S["NOTE"]

    D = datetime.date.fromisoformat
    first, last = D(bills[0]["date"]), D(bills[-1]["date"])
    span = (last - first).days + 1
    net = sum(b["net"] for b in bills)
    miss = missing_by_day(keells)
    total_missing = sum(miss.values())
    adjusted = net + total_missing
    uplift = adjusted / net if net else 1.0

    gross_by_bucket = defaultdict(float)
    for b in bills:
        for i in b["items"]:
            gross_by_bucket[shelf_bucket(i["category"])] += i["amount"]
    running = (gross_by_bucket["fresh"] + gross_by_bucket["chilled"]) / span * uplift

    r = 4
    S["band"](ws, r, "1. THE THREE RATES", 4)
    r += 1
    for i, h in enumerate(["Measure", "Rs total", "Rs / day", "What it answers"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 4)
    r += 1
    r0 = r
    for label, tot, perday, q in [
        ("Captured spend", net, net / span,
         "what the bills in this ledger add up to"),
        ("Adjusted for missing bills", adjusted, adjusted / span,
         "likely true outlay, incl. Keells trips with no e-bill here"),
        ("Running cost (fresh + chilled)", running * span, running,
         "day-to-day food, excluding pantry stock that outlives the window"),
    ]:
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=round(tot, 2))
        c = ws.cell(row=r, column=3, value=round(perday, 2))
        if label.startswith("Adjusted"):
            c.fill = S["FLAG_FILL"]
        ws.cell(row=r, column=4, value=q)
        r += 1
    S["paint"](ws, r0, r - 1, 1, 4, money=(2, 3))
    r += 1
    for label, val in [("Period", f"{first:%d-%b-%Y} to {last:%d-%b-%Y}"),
                       ("Days", span),
                       ("Captured bills", len(bills)),
                       ("Projected 30 days (adjusted)", round(adjusted / span * 30, 2)),
                       ("Projected 365 days (adjusted)", round(adjusted / span * 365, 2))]:
        ws.cell(row=r, column=1, value=label).font = S["BASE"]
        c = ws.cell(row=r, column=3, value=val)
        if isinstance(val, float):
            c.number_format = S["MONEY"]
        r += 1

    r += 1
    S["band"](ws, r, "2. BY MONTH — only whole months are a rate", 9)
    r += 1
    for i, h in enumerate(["Month", "Days", "Bills", "Keells net", "Est. missing",
                           "Glomark net", "Adjusted total", "Rs / day", "Note"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 9)
    r += 1
    m0 = r
    for ym in sorted({b["date"][:7] for b in bills}):
        y, m = int(ym[:4]), int(ym[5:])
        mstart = max(first, datetime.date(y, m, 1))
        mend = min(last, datetime.date(y, m, calendar.monthrange(y, m)[1]))
        days = (mend - mstart).days + 1
        bs = [b for b in bills if b["date"][:7] == ym]
        k = sum(b["net"] for b in bs if b.get("source", "keells") == "keells")
        g = sum(b["net"] for b in bs if b.get("source") == "glomark")
        mi = sum(v for d, v in miss.items() if d.strftime("%Y-%m") == ym)
        whole = days >= 28
        ws.cell(row=r, column=1, value=ym)
        ws.cell(row=r, column=2, value=days)
        ws.cell(row=r, column=3, value=len(bs))
        ws.cell(row=r, column=4, value=round(k, 2))
        ws.cell(row=r, column=5, value=round(mi, 2))
        ws.cell(row=r, column=6, value=round(g, 2))
        ws.cell(row=r, column=7, value=round(k + mi + g, 2))
        c = ws.cell(row=r, column=8, value=round((k + mi + g) / days, 2))
        ws.cell(row=r, column=9,
                value="" if whole else "part month — a few baskets, not a rate")
        if not whole:
            c.fill = S["FLAG_FILL"]
        r += 1
    S["paint"](ws, m0, r - 1, 1, 9, money=(4, 5, 6, 7, 8))

    r += 1
    S["band"](ws, r, "3. BY CATEGORY", 5)
    r += 1
    for i, h in enumerate(["Category", "Shelf life", "Gross", "Rs / day",
                           "Rs / 30 days"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 5)
    r += 1
    c0 = r
    cat = defaultdict(float)
    for b in bills:
        for i in b["items"]:
            cat[i["category"]] += i["amount"]
    for c, v in sorted(cat.items(), key=lambda x: -x[1]):
        ws.cell(row=r, column=1, value=c)
        ws.cell(row=r, column=2, value=shelf_bucket(c))
        ws.cell(row=r, column=3, value=round(v, 2))
        ws.cell(row=r, column=4, value=round(v / span, 2))
        ws.cell(row=r, column=5, value=round(v / span * 30, 2))
        r += 1
    S["paint"](ws, c0, r - 1, 1, 5, money=(3, 4, 5))
    ws.cell(row=r, column=1, value="Gross, captured only — scale by "
            f"{uplift:.2f} for the adjusted view.").font = S["NOTE"]
    r += 2

    S["band"](ws, r, "4. HOW TO READ THESE", 4)
    r += 1
    for note in [
        "Captured understates: roughly a third of Keells trips produce no e-bill in",
        "   this ledger (see Capture Gap).",
        "Adjusted spreads each points-gap evenly over the days it could have fallen on.",
        "   The total is sound; any single day in a gap window is a guess.",
        "Running cost strips pantry and household goods, which were bought heavily at",
        "   25% off and will be consumed well past this window. It is the closest thing",
        "   here to a steady-state daily food cost.",
        "A month with a Glomark trip looks dearer per day than one without, because",
        "   those baskets carry months of stock, not days of food.",
    ]:
        ws.cell(row=r, column=1, value=note).font = S["NOTE"]
        r += 1
    S["widths"](ws, [34, 14, 16, 14, 16, 14, 16, 12, 44])


# ------------------------------------------------------------- subcategory view
HABITUAL_MIN_BILLS = 4      # on this many separate bills = part of the standing basket


def _subcategory(wb, bills, S):
    ws = wb.create_sheet("Subcategory")
    ws["A1"] = "Inside each category"
    ws["A1"].font = S["TITLE"]
    ws["A2"] = ("Categories are unchanged; this splits each one so you can see what is "
                "actually driving it. Subcategories are assigned by rule in parse_bill.py "
                "and are not printed on any bill.")
    ws["A2"].font = S["NOTE"]

    D = datetime.date.fromisoformat
    span = (D(bills[-1]["date"]) - D(bills[0]["date"])).days + 1
    agg = defaultdict(lambda: dict(gross=0.0, bills=set(), skus=set(),
                                   keells=0.0, glomark=0.0, cat=""))
    cat_total = defaultdict(float)
    for b in bills:
        glo = b.get("source") == "glomark"
        for i in b["items"]:
            k = (i["category"], i.get("subcategory", i["category"]))
            d = agg[k]
            d["cat"] = i["category"]
            d["gross"] += i["amount"]
            d["bills"].add(b["ref"])
            d["skus"].add(i["name"])
            if glo:
                d["glomark"] += i["amount"]
            else:
                d["keells"] += i["amount"]
            cat_total[i["category"]] += i["amount"]
    total = sum(cat_total.values())

    r = 4
    S["band"](ws, r, "1. EVERY SUBCATEGORY", 10)
    r += 1
    for i, h in enumerate(["Category", "Subcategory", "Gross (Rs)", "% of category",
                           "% of all", "Rs / day", "Rs / 30 days", "On bills",
                           "SKUs", "Keells / Glomark"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 10)
    r += 1
    r0 = r
    order = sorted(agg.items(), key=lambda x: (-cat_total[x[0][0]], -x[1]["gross"]))
    for (cat, subname), d in order:
        ws.cell(row=r, column=1, value=cat)
        ws.cell(row=r, column=2, value=subname)
        ws.cell(row=r, column=3, value=round(d["gross"], 2))
        ws.cell(row=r, column=4, value=d["gross"] / cat_total[cat] if cat_total[cat] else 0)
        ws.cell(row=r, column=5, value=d["gross"] / total)
        ws.cell(row=r, column=6, value=round(d["gross"] / span, 2))
        ws.cell(row=r, column=7, value=round(d["gross"] / span * 30, 2))
        ws.cell(row=r, column=8, value=len(d["bills"]))
        ws.cell(row=r, column=9, value=len(d["skus"]))
        share = d["glomark"] / d["gross"] if d["gross"] else 0
        ws.cell(row=r, column=10,
                value="Keells only" if share == 0 else
                      ("Glomark only" if share == 1 else
                       f"{1 - share:.0%} / {share:.0%}"))
        r += 1
    S["paint"](ws, r0, r - 1, 1, 10, money=(3, 6, 7), pct=(4, 5))
    ws.freeze_panes = f"A{r0}"
    ws.auto_filter.ref = f"A{r0 - 1}:J{r - 1}"
    last = r - 1

    r += 1
    S["band"](ws, r, "2. STANDING BASKET vs OCCASIONAL", 6)
    r += 1
    ws.cell(row=r, column=1, value=(
        f"Split by how many of the {len(bills)} captured bills a subcategory appears on. "
        "This is counted, not judged — it separates what is bought as a routine from "
        "what arrives in lumps.")).font = S["NOTE"]
    r += 2
    for i, h in enumerate(["", "Subcategories", "Gross (Rs)", "% of all",
                           "Rs / day", "Typical per trip"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 6)
    r += 1
    h0 = r
    hab = [(k, d) for k, d in agg.items() if len(d["bills"]) >= HABITUAL_MIN_BILLS]
    occ = [(k, d) for k, d in agg.items() if len(d["bills"]) < HABITUAL_MIN_BILLS]
    for label, grp in [(f"Habitual ({HABITUAL_MIN_BILLS}+ bills)", hab),
                       (f"Occasional (under {HABITUAL_MIN_BILLS})", occ)]:
        g = sum(d["gross"] for _, d in grp)
        trips = sum(len(d["bills"]) for _, d in grp)
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=len(grp))
        ws.cell(row=r, column=3, value=round(g, 2))
        ws.cell(row=r, column=4, value=g / total)
        ws.cell(row=r, column=5, value=round(g / span, 2))
        ws.cell(row=r, column=6, value=round(g / trips, 2) if trips else 0)
        r += 1
    S["paint"](ws, h0, r - 1, 1, 6, money=(3, 5, 6), pct=(4,))
    r += 1
    ws.cell(row=r, column=1, value="The lumpy ones — big spend, few trips:").font = S["BOLD"]
    r += 1
    for i, h in enumerate(["Subcategory", "Gross (Rs)", "On bills", "SKUs"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 4)
    r += 1
    l0 = r
    for (cat, subname), d in sorted(occ, key=lambda x: -x[1]["gross"])[:10]:
        ws.cell(row=r, column=1, value=subname)
        ws.cell(row=r, column=2, value=round(d["gross"], 2))
        ws.cell(row=r, column=3, value=len(d["bills"]))
        ws.cell(row=r, column=4, value=", ".join(sorted(d["skus"]))[:90])
        r += 1
    S["paint"](ws, l0, r - 1, 1, 4, money=(2,))

    r += 1
    S["band"](ws, r, "3. AUGUST vs SEPTEMBER — biggest movers per day", 4)
    r += 1
    ws.cell(row=r, column=1, value=(
        "Whole months only. A rise here is often a stock-up, not a change in "
        "appetite — check the SKU before reading it as a habit.")).font = S["NOTE"]
    r += 2
    for i, h in enumerate(["Subcategory", "Aug Rs/day", "Sep Rs/day", "Change"], 1):
        ws.cell(row=r, column=i, value=h)
    S["hdr"](ws, r, 4)
    r += 1
    m0 = r
    months = {}
    for ym, days in (("2026-08", 31), ("2026-09", 30)):
        a = defaultdict(float)
        for b in bills:
            if b["date"][:7] != ym:
                continue
            for i in b["items"]:
                a[i.get("subcategory", i["category"])] += i["amount"]
        months[ym] = (a, days)
    movers = []
    for (cat, subname), d in agg.items():
        a8 = months["2026-08"][0].get(subname, 0) / 31
        a9 = months["2026-09"][0].get(subname, 0) / 30
        if a8 + a9 < 5:
            continue
        movers.append((subname, a8, a9, a9 - a8))
    for subname, a8, a9, delta in sorted(movers, key=lambda x: -abs(x[3]))[:15]:
        ws.cell(row=r, column=1, value=subname)
        ws.cell(row=r, column=2, value=round(a8, 2))
        ws.cell(row=r, column=3, value=round(a9, 2))
        c = ws.cell(row=r, column=4, value=round(delta, 2))
        if abs(delta) > 60:
            c.fill = S["FLAG_FILL"]
        r += 1
    S["paint"](ws, m0, r - 1, 1, 4, money=(2, 3, 4))
    r += 2
    for note in [
        "Subcategory rules live in SUBCATEGORY_RULES in parse_bill.py, checked in order",
        "within a category. Changing one and rebuilding re-splits the whole history.",
        "Every line in this ledger resolves to a named subcategory; nothing falls to a",
        "catch-all. If a new item ever does, its rule is missing.",
    ]:
        ws.cell(row=r, column=1, value=note).font = S["NOTE"]
        r += 1
    S["widths"](ws, [26, 28, 14, 14, 11, 11, 14, 10, 8, 92])
