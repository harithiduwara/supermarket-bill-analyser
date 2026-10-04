# Category assignment

Categories are **not printed on the bills**. They are assigned by
`parse_bill.py` in this order — first match wins.

## 1. Bags

Item codes `77777` (large), `66666` (medium), `R1234` (reusable), `E1234`
(reusable refund), or a name matching `POLYTHENE BAG|KEELLS BAG`.

The `R1234` / `E1234` pair nets to zero — it is the reusable-bag charge and its
immediate refund. The Rs 6.00 green discount is booked separately as a
promotion.

## 2. Department-code prefix (authoritative for fresh)

| Prefix | Category | Examples seen |
|---|---|---|
| 912–916 | Vegetables | onions, tomatoes, lime, gotukola, garlic, mushroom, kohila ala, coconut, leeks, bell pepper, cucumber, coriander |
| 923 | Fruit | mango TJC, melon, dragon fruit, banana ambul, woodapple, mangosteen |
| 935 | Meat & fish | chicken whole legs, chicken full breast |
| 941 | Meat & fish | thalapath |
| 951–957 | Bakery | bread, hot dog bun, doughnut, cheesy volcano bun, chicken bun, pie |

### Glomark

Glomark runs its own numbering. Packaged goods use unstructured 1xxxxx codes
and fall through to the keyword rules.

| Prefix | Category | Examples seen |
|---|---|---|
| 310 | Vegetables | garlic, potatoes, ginger, lime, onions, cucumber, tomatoes, capsicum, ladies fingers, kankun, oyster mushroom, coconut |
| 311 | Fruit | (reserved; none seen yet) |
| 340 | Meat & fish | chicken breast, chicken whole legs |
| 350 | Bakery | hamburger bun |

## 3. Keyword rules (packaged aisles, no useful code structure)

The order below is load-bearing. Three real bugs were fixed by it:

- `NATURE SECRETS DEEP CLEANSING MILK` is not dairy, so **personal care is
  tested before milk**.
- `CHICKEN SAUSAGES` must not fall through to a milk rule, so **processed meat
  sits above dairy**.
- `CHOCOLATE` contains the substring `COLA`. Short tokens carry word
  boundaries: `\bCOLA\b`, `\bHAM\b`, `\bSODA\b`, `\bBUTTER\b`.

1. **Household & personal care** — dish wash, detergent, soap, shampoo, tooth, cleansing, wrapping, tissue, bleach, sanitary, diaper, lotion, deodorant, serviette, napkin, paper/kitchen towel, toilet
2. **Processed meat** — sausage, meat ball, bacon, ham, salami, nugget
3. **Bakery** — croissant, muffin, doughnut, bun, bread, pastry, pie, baguette (catches branded packaged bakery that carries no 95x code, e.g. Finagle)
4. **Instant noodles** — noodle, ramen, kottu mee (above dairy: "KOREAN RAMEN CHEESE" is a noodle pack)
5. **Dairy & eggs** — milk, cheese, curd, eggs, yoghurt, butter, full cream, ice cream, ghee, milkmaid, condensed milk
5. **Beverages** — coffee, tea, cola, juice, nectar, drink, soda, mineral water, energy, tetra, pet, "can 250ml"
6. **Snacks & confectionery** — biscuit, choc, popcorn, peanut, chips, crisp, cake, snack, wafer, candy
7. **Condiments & spices** — sauce, ketchup, chilli powder, curry powder, cardamom, mustard, cinnamon, turmeric, salt, vinegar, mayonnaise
8. **Instant noodles** — noodle, ramen, kottu mee
9. **Staples & grocery** — rice, flour, sugar, oil, paratha, samaposha, dhal, pasta, lentil, coconut, cereal, oats

`TETRA` and `PET` sit in Beverages but below Dairy, so
`KOTMALE FLAV MILK UHT CHOCO TETRA` still lands correctly in dairy.

Anything unmatched becomes **Other grocery**. If that bucket starts growing,
add a rule rather than letting it absorb real spend.

## Name overrides

`NAME_OVERRIDE` in `parse_bill.py` is checked before the department table, for
fresh items whose department code contradicts what they actually are.

| Name | Forced to | Why |
|---|---|---|
| AMBARELLA | Fruit | code 916002 sits in the 916 range, which otherwise holds cooking vegetables like MANGO CURRY (916028) |
| PUSSALLA COCKTAIL MIX 350G | Processed meat | Pussalla is a meat processor and this is cocktail sausages, but "COCKTAIL MIX" is too ambiguous for a keyword rule — it would also catch a nut mix or a drink mix |
| AVOCADO JUICE | Beverages | code 955002 sits in the 95x in-store-counter range, which is otherwise bakery; 955 appears to be the fresh-juice counter, but one observation is not enough to reassign the whole prefix |

Only add names actually seen on a bill. Guessing at codes you haven't observed
puts untested rules in the path of real data.

## Judgement calls worth knowing

- `KEELLS SNACKS CHEESE` is a cheese-flavoured snack, not dairy. The dairy rule
  matches `CHEESE SPREAD` explicitly rather than bare `CHEESE`, so this lands in
  Snacks as intended.
- `ROTI PARATHA` is chilled, but sits in Staples because that is how it is used
  in this household.
- `COCONUT` (code 912005) hits the department prefix first and lands in
  Vegetables, which is where Keells shelves it.
- Coffee and tea fall under Beverages. Split them out if the monthly coffee
  spend becomes worth tracking on its own.


---

# Subcategories

A second level under `category`, added so a 28%-of-spend category like Dairy can
be read. Categories themselves are unchanged — every subcategory rolls up to
exactly one, and the two always reconcile.

Rules live in `SUBCATEGORY_RULES` in `parse_bill.py`: a list of
`(regex, subcategory)` per category, checked **in order within that category**.
A pattern only has to be unambiguous among its own category's items, which is
why `\bBUTTER\b` is safe under Dairy but would not be as a global rule. The last
entry of each list is a catch-all.

| Category | Subcategories |
|---|---|
| Dairy & eggs | Liquid milk · Milk powder · Flavoured milk · Condensed milk · Butter · Cheese · Yoghurt & curd · Ice cream · Eggs |
| Meat & fish | Chicken - breast · Chicken - legs · Chicken - other · Fresh fish · Tinned fish |
| Staples & grocery | Rice · Cooking oil · Flour & semolina · Flatbread · Frozen potato · Sugar · Pulses · Cereal |
| Beverages | Coffee · Tea · Carbonated soft drinks · Energy & functional drinks · Juice & nectar |
| Vegetables | Alliums · Roots & tubers · Leafy greens · Fruiting vegetables · Mushrooms · Aromatics · Coconut |
| Household & personal care | Cleaning · Personal care · Paper & disposables |
| Bakery | Bread · Buns · Sweet pastry · Savoury baked |
| Processed meat | Sausages & cold cuts · Meatballs & nuggets |
| Condiments & spices | Mayonnaise & dressings · Sauces · Spices · Baking flavours |
| Snacks & confectionery | Chocolate & sweets · Savoury snacks · Biscuits & cake |
| Fruit | Mango · Exotic fruit · Local fruit · Melon |
| Instant noodles | Prima · Maggi |
| Bags | Polythene bags · Reusable bag |

## Ordering that matters

- Dairy: `MILK POWDER` and `CONDENSED` are tested before `UHT`, or milk powder
  would land in Liquid milk. `ICE CREAM` before `BUTTER`, and flavoured milk
  before liquid milk.
- Meat: tinned fish before fresh fish, and both before the chicken rules, so
  `DIAMOND TUNA IN SUNFLOWER OIL` does not have to compete with them.
- Fruit: `MANGO(?!STEEN)` — a plain `MANGO` would swallow MANGOSTEEN.
- Vegetables: `MANGO CURRY` is a cooking vegetable and falls to Fruiting
  vegetables, which is correct; it never reaches the Fruit rules because its
  category is already Vegetables.
- Bakery: savoury before sweet, so `CHICKEN BUN` does not land in Buns.

All 24 bills resolve with no item reaching a catch-all. If one ever does, the
rule for it is missing — add it rather than leaving it in "Other".
