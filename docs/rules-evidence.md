# Promotion and points rules — the evidence

> **Anonymised.** The rules below were inferred from 24 real bills belonging to one household. Dates, times, card
> digits, ticket numbers and individual bill totals have been removed on purpose (the product is public — see
> [ADR-0007](adr/0007-public-product-no-real-data.md)). What is kept is each rule, **how many observations support it**,
> and the caveats. Re-verify whenever the arithmetic stops tying.
>
> None of this is printed on the bills. The synthetic demo bills in `src/domain/demo.ts` are built _from_ these rules, so
> they show the code applies the rules consistently — they are **not** independent evidence that Keells or Glomark behave
> this way.

## Keells — "NTB | 25% off on Fresh"

Observed on **3 bills**, all on a Sunday.

| Rule                                                                          | Evidence                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Pays on fruit, vegetables and poultry — department prefixes 912–916, 923, 935 | base × 25% ties to the cent on the two uncapped bills                                                      |
| **Fish is excluded** (prefix 941)                                             | one bill carried a fish line (about Rs 800) that drew nothing                                              |
| Computed **after** line-level Keells/Nexus discounts                          | one bill's payout only ties if a discounted line enters the base at its discounted value                   |
| Hard cap of **Rs 1,500 per bill**                                             | one bill's uncapped 25% was above Rs 1,500 and the payout stopped exactly on it                            |
| Fires on **Sundays only**                                                     | all three hits were Sundays; a Friday bill on the same bank card with about Rs 670 of poultry drew nothing |

The Sunday rule is the weakest inference — it fits every bill seen but is not stated anywhere. **Treat it as a strong
hypothesis** and check against the issuer's published terms before relying on it.

The cap bites at a fresh basket of about Rs 6,000. Above that, splitting the shop across two Sundays captures more.

## Other Keells schemes seen

- **Nexus Deals** — Keells' own loyalty scheme, line-level, 20–25%. Not card-linked.
- **Keells Deals** — line-level, 10–17%, on specific SKUs.
- **Quick Sales / QuickDeal** — clearance on short-dated stock, 30–50%, bakery and vegetables. **Four observations** across two
  categories and three stores. They show the rate rising with the hour (30–31% at midday and early evening, 50% after 19:30).
  An earlier note called this an end-of-evening promotion; a lunchtime observation disproves that. Treat the time-of-day
  relationship as a **pattern worth watching, not a rule**.
- **Green Discount** — Rs 6.00 per reusable bag brought in, booked against item code `R1234`.

## Line-discount rounding

Keells rounds a fractional line discount **up** to the whole rupee. Of 18 line-level promotions observed, 10 had a
fractional exact value and **all 10 rounded up**; 8 were already whole; none rounded down.

    price 365.00 × 25%   = 91.25  ->  92.00
    price  54.72 × 30%   = 16.42  ->  17.00
    price  60.00 × 16.6% =  9.96  ->  10.00

A modelled discount a rupee or two under the printed one is this rounding, not an error.

## Deal rates move

The same SKU does not keep the same rate: one SKU ran at 16.6% on several bills and at **10.0%** on a later one; another has held 15.1% across
three bills. Never carry a rate forward as fixed — read it off the bill.

## Loyalty points

Earn rate is a flat **0.34% of net**, exact on every Keells bill seen.

The balance printed on a bill is the balance **before** that bill's points post, so `balance(n) = balance(n−1) + earned(n−1)`.
A break in that chain means either a bill not in the ledger or a bonus credit. Convert the gap at 0.34% to get implied
spend; a gap implying more than about **Rs 30,000** is a credit, not a basket.

## Glomark — separate routes to 25%

Glomark reaches 25% by more than one mechanism, under different names and on different cards. **Three bills seen, one per scheme.**

| Scheme printed                              | Effective rate                         | Cap          |
| ------------------------------------------- | -------------------------------------- | ------------ |
| "OTHER PROMOTION - GLOMARK POWER HOURS 25%" | about 21–22% (several lines excluded)  | none seen    |
| "BANK PROMOTION - SEYLAN CC 25%"            | about 25% (almost nothing excluded)    | none seen    |
| "BANK PROMOTION - SAMPATH BANK CC 25%"      | about 14% (large exclusions and a cap) | **Rs 2,500** |

**The cap is per scheme, not per store.** The other two schemes each paid out above Rs 3,000 on a single bill; only the Sampath bill stopped dead on Rs 2,500.00.

### How the cap is applied

Not by scaling every line down. On the capped bill all lines but one took exactly 25%; **one line was truncated** so the bill
total landed on the cap (that line took about 15.6% instead of 25%). It was a middle line, not the last, so the POS is not
working down the printed order. Do not assume which line absorbs the cap.

### Exclusions belong to the scheme

| Scheme      | Excluded                                                                |
| ----------- | ----------------------------------------------------------------------- |
| Power Hours | eggs, UHT milk, milk powder, carrier bag                                |
| Seylan      | carrier bags only                                                       |
| Sampath     | fresh chicken, UHT milk, coconut, eggs (about 40% of that bill's gross) |

Same store, same month — so the scheme decides, and the exclusion list is worth checking before choosing a card for a big basket.
A flavoured-milk drink _was_ discounted under Sampath, so the milk exclusion is UHT and milk powder, not bare "milk". "EGG MAYONNAISE" was
discounted, so the egg exclusion is not a bare "EGG".

### Power Hours

One bill: 26 of 31 lines at 25%, one bakery line at **40%** under a separate "MULTIPLE PROMOTION" (item-level), four lines excluded.
"Power Hours" implies a time window, but two bills timed in the early evening are not enough to infer one. **Do not assert a window.**

### Softlogic One points — rate unresolved

Three bills gave three different earn rates (roughly 0.33%, 0.39% and 0.46% of net). Unlike the Keells 0.34% there is **no flat rate to
assume**, and the spread is too wide for rounding — points appear to be computed per line with exclusions. **Record what is printed and
never derive a Softlogic figure from net.** The printed balance does not chain either (it lands 4–5 short of the running total); a
"floor to the nearest 5" rule fitted one pair and failed the next. Three observations do not settle it. The balance carries a printed expiry date.

## What this evidence cannot tell you

- Each Glomark exclusion list rests on **one bill**, and each bill was on a **different weekday**, so day restrictions are unknown.
- The Keells Sunday rule and the time-of-day pattern for clearance stock are hypotheses.
- Everything here came from one household shopping at a handful of stores; a new store code or chain needs its own evidence.
