# Promotion rules, reverse-engineered

None of this is printed on the bills. All of it was derived by matching the
bills where each promotion fired. Re-verify if the arithmetic stops tying.

## NTB | 25% off on Fresh

Observed on three bills: 02-Aug-2026 (Rs 713.00), 23-Aug-2026 (Rs 1,500.00),
06-Sep-2026 (Rs 473.00).

| Rule | Evidence |
|---|---|
| Pays on fruit, vegetables and poultry — prefixes 912–916, 923, 935 | base x 25% ties to the cent on 02-Aug and 06-Sep |
| **Fish is excluded** (prefix 941) | 06-Sep: Rs 828.80 of thalapath drew nothing |
| Computed **after** line-level Keells/Nexus discounts | 06-Sep: cucumber entered at Rs 84.00, not Rs 105.00 |
| Hard cap of **Rs 1,500 per bill** | 23-Aug: base Rs 6,316.34, uncapped 25% = Rs 1,579.09, paid Rs 1,500.00 |
| Fires on **Sundays only** | all three hits were Sundays; 04-Sep (Friday) used the NTB card with Rs 672.80 of poultry and drew nothing |

The Sunday rule is the weakest inference — it fits every bill seen but is not
stated anywhere. Treat it as a strong hypothesis, and check against NTB's
published terms before relying on it.

The cap bites at a fresh basket of Rs 6,000. Above that, splitting across two
Sundays captures more.

## Other schemes seen

- **Nexus Deals** — Keells' own loyalty scheme, line-level, 20–25%. Not card-linked.
- **Keells Deals** — line-level, 10–17%, on specific SKUs.
- **Quick Sales / QuickDeal** — clearance on short-dated stock, 30-50%, bakery and
  vegetables. Four observations:

  | Date | Time | Item | Rate |
  |---|---|---|---|
  | 02-Oct | 12:20 | Chelsea bun | 30% |
  | 23-Aug | 18:42 | Snake gourd | 31% |
  | 05-Aug | 19:59 | Hot dog bun | 50% |
  | 22-Aug | 21:08 | Chocolate doughnut | 50% |

  An earlier note here called this an end-of-evening promotion. The 02-Oct bill
  disproves that: it fired at lunchtime. What the four do show is the rate rising
  with the hour — 30-31% at midday and early evening, 50% after 19:30. Four
  observations across two categories and three stores is thin; treat the time-of-day
  relationship as a pattern worth watching, not a rule.
- **Green Discount** — Rs 6.00 per reusable bag brought in, booked against `R1234`.

## Line-discount rounding

Keells rounds a fractional line discount **up** to the whole rupee. 18 line-level
promotions observed: 10 had a fractional exact value and all 10 rounded up; 8 were
already whole; none rounded down.

    coconut oil   1,850.00 x 25%   = 462.50  ->  463.00
    toothpaste      365.00 x 25%   =  91.25  ->   92.00
    snake gourd      54.72 x 30%   =  16.42  ->   17.00
    chokstick        60.00 x 16.6% =   9.96  ->   10.00

Worth knowing when a modelled discount is checked against a bill: a predicted
value a rupee or two under the printed one is this rounding, not an error.

## Deal rates move

The same SKU does not keep the same rate. MAGIC CHOKSTICK (128514) ran at 16.6%
on 04-Sep, 06-Sep and 10-Sep, then **10.0%** on 03-Oct. KIST RIDE has held 15.1%
across three bills and two flavours. Never carry a rate forward as fixed — read
it off the bill.

## Loyalty points

Earn rate is a flat **0.34% of net**, exact on every bill seen.

The balance printed on a bill is the balance **before** that bill's points post.
So `balance(n) = balance(n-1) + earned(n-1)`. A break in that chain means either
a bill not in the ledger or a bonus credit. Convert the gap at 0.34% to get
implied spend; if the result exceeds any plausible basket, it is a credit.

## Glomark — two separate routes to 25%

Glomark reaches 25% by more than one mechanism. Both bills seen hit it, under
different names and on different cards.

| Date | Scheme printed | Card | Discount | Effective | Cap |
|---|---|---|---|---|---|
| 02-Sep-2026 18:56 | OTHER PROMOTION - GLOMARK POWER HOURS 25% | Visa **1811 | 3,823.22 | 21.65% | none seen |
| 12-Sep-2026 19:49 | BANK PROMOTION - SEYLAN CC25% | Visa **70 | 3,030.50 | 24.98% | none seen |
| 24-Sep-2026 22:40 | BANK PROMOTION - SAMPATH BANK CC 25% | Visa **11 | 2,500.00 | 14.15% | **Rs 2,500** |

**The cap is per scheme, not per store.** Two bills paid out above Rs 2,500
(3,823.22 and 3,030.50), so neither Power Hours nor the Seylan promotion caps
at that level. The Sampath bill stopped dead on Rs 2,500.00.

### How the cap is applied

Not by scaling every line down. On 24-Sep, 32 of 33 discounted lines took
exactly 25%; one line was truncated so the bill total landed on the cap:

    eligible gross                 10,566.61
    25% uncapped                    2,641.66
    paid out                        2,500.00
    withheld                          141.66   <- all of it off one line

SOUL CHOCOLATE MILK DRINK, gross 1,510.00, took 235.84 instead of 377.50 —
15.62%. The truncated line was line 21 of 33, not the last, so the POS is not
working down the printed order. Do not assume which line absorbs the cap.

### Exclusions belong to the scheme

| Bill | Excluded |
|---|---|
| 02-Sep Power Hours | eggs, UHT milk, milk powder, carrier bag (4 of 31) |
| 12-Sep Seylan | carrier bags only (1 of 14) |
| 24-Sep Sampath | fresh chicken, UHT milk, coconut, eggs (5 of 33, Rs 7,103.16 = 40% of the bill) |

The Seylan promotion discounted nearly everything. Sampath excluded the two
largest lines on the bill. Same store, same month — so the scheme decides, and
the exclusion list is worth checking before choosing a card for a big basket.

### Power Hours, 02-Sep-2026

| Tier | Lines | Note |
|---|---|---|
| 25% off | 26 of 31 | "OTHER PROMOTION - GLOMARK POWER HOURS 25%" |
| 40% off | 1 | "MULTIPLE PROMOTION", item-level, on a bakery bun |
| no discount | 4 | eggs, UHT milk, milk powder, carrier bag |

Effective rate on the bill was 21.65% — no cap observed, which is the important
difference from the Keells NTB fresh promotion. The excluded lines are the same
kind of goods Keells also excludes: dairy staples at a regulated or near-fixed
price.

"Power Hours" implies a time window. Two bills, timed 18:56 and 19:49, are not
enough to infer one. Do not assert a window.

### Softlogic One points — rate unresolved

| Bill | Net | Earned | Rate | Balance shown |
|---|---|---|---|---|
| 02-Sep | 13,832.64 | 53.97 | 0.3902% | 195 |
| 12-Sep | 9,101.50 | 30.26 | 0.3325% | 245 |
| 24-Sep | 15,169.77 | 69.73 | 0.4597% | 270 |

Three bills, three different rates. Unlike the Keells 0.34% there is **no flat
rate to assume**, and the spread is too wide for rounding — points are computed
per line with exclusions, so record what is printed and never derive a
Softlogic figure from net.

The balance does not chain either:

    195 + 53.97 = 248.97  ->  next bill shows 245
    245 + 30.26 = 275.26  ->  next bill shows 270

A "floor to the nearest 5" rule fitted the first pair and **fails on the
second** (it predicts 275, the receipt says 270). Both shown balances land 4-5
short of the running total. Three observations do not settle it. State the
printed balance and leave it there.

The balance carries a printed expiry: 28-Feb.
