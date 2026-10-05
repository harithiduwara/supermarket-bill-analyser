/** Synthetic bills: a deterministic generator, an e-bill text renderer, and the demo ledger.
 *
 * WHY THIS EXISTS. The product is public, so no real customer's bills may ship in the repository or the bundle
 * (docs/adr/0007, scripts/check-privacy.mjs). Everything here is invented: store addresses, till and receipt numbers,
 * card suffixes, names and amounts belong to nobody.
 *
 * WHAT IT PROVES. The generator builds each bill from structured data, renders it to the same text a Keells e-bill
 * has (both summary layouts), and the tests push that text back through the real parser and require the original
 * bill back, every time, for hundreds of random seeds. That is a round-trip property, not a comparison with
 * one person's bills.
 *
 * WHAT IT DOES NOT PROVE. The discount-scheme rules embedded below (NTB fresh 25% with a Rs 1,500 cap, bank-card
 * 25% with exclusions, line discounts rounded up to the rupee) are the rules inferred from the original real bills
 * (see docs/rules-evidence.md). Bills built from those rules show the code applies them consistently; they are not
 * independent evidence that Keells or Glomark really behave that way. Say so wherever that is relied on.
 */
import { round, sum } from "./num";
import { buildReceipt, type ReceiptInput, type ReceiptLineInput } from "./receipt";
import { POINTS_RATE, STORE_NAMES } from "./rules";
import type { Bill, BillItem, Promotion, Tender } from "./types";

// ------------------------------------------------------------------------------------------- randomness
export type Rng = () => number;

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: Rng, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
function sample<T>(r: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

// --------------------------------------------------------------------------------------------- catalogue
interface Product {
  code: string;
  name: string;
  price: number;
  /** sold by weight: quantity is kilograms with three decimals */
  kg?: boolean;
}

/** Product names are generic descriptions on purpose; several are the known classification traps
 * (CHOCOLATE vs COLA, EGG MAYONNAISE, CLEANSING MILK, KOREAN RAMEN CHEESE, MILK CHOCOLATE vs FLAV MILK, TUNA IN
 * SUNFLOWER OIL, MANGOSTEEN, MILKMAID) so the rules engine is tested against them. */
export const KEELLS_FRESH: Product[] = [
  { code: "914101", name: "BIG ONIONS", price: 290, kg: true },
  { code: "915101", name: "TOMATOES", price: 570, kg: true },
  { code: "914102", name: "CARROTS", price: 420, kg: true },
  { code: "914103", name: "POTATOES", price: 350, kg: true },
  { code: "914104", name: "LIME", price: 480, kg: true },
  { code: "914105", name: "GINGER", price: 1480, kg: true },
  { code: "914106", name: "GARLIC", price: 920, kg: true },
  { code: "912101", name: "LEAFY GREENS PKT 100G", price: 150 },
  { code: "923101", name: "BANANA AMBUL", price: 360, kg: true },
  { code: "923102", name: "MANGO", price: 700, kg: true },
  { code: "923103", name: "MANGOSTEEN", price: 1200, kg: true },
  { code: "923104", name: "WATERMELON", price: 210, kg: true },
  { code: "935101", name: "CHICKEN BREAST FRESH", price: 1700, kg: true },
  { code: "935102", name: "CHICKEN LEGS FRESH", price: 1250, kg: true },
  { code: "941101", name: "THALAPATH FRESH FISH", price: 2400, kg: true },
];
export const KEELLS_BAKERY: Product[] = [
  { code: "951101", name: "SANDWICH BREAD 450G", price: 150 },
  { code: "952101", name: "HOT DOG BUN 2S", price: 220 },
  { code: "956101", name: "CHICKEN BUN", price: 200 },
  { code: "957101", name: "DOUGHNUT CHOCOLATE TOPPING", price: 220 },
];
export const KEELLS_PACKAGED: Product[] = [
  { code: "110101", name: "FULL CREAM UHT MILK 1L", price: 580 },
  { code: "110102", name: "FULL CREAM MILK POWDER 400G", price: 1250 },
  { code: "110103", name: "FLAV MILK UHT CHOCO TETRA 170ML", price: 100 },
  { code: "110104", name: "MILKMAID CONDENSED MILK 390G", price: 420 },
  { code: "110105", name: "EGGS BROWN LARGE 10S", price: 610 },
  { code: "110106", name: "EGG MAYONNAISE 270G", price: 480 },
  { code: "110107", name: "BUTTER 200G", price: 780 },
  { code: "110108", name: "CHEESE SLICES 200G", price: 950 },
  { code: "110109", name: "YOGHURT NATURAL 80G", price: 90 },
  { code: "110110", name: "ICE CREAM VANILLA 1L", price: 850 },
  { code: "120101", name: "CLEANSING MILK 200ML", price: 1100 },
  { code: "120102", name: "SOAP BAR 100G", price: 120 },
  { code: "120103", name: "DISH WASH LIQUID 500ML", price: 450 },
  { code: "120104", name: "TOOTHPASTE 200G", price: 365 },
  { code: "120105", name: "TISSUE ROLLS 4S", price: 380 },
  { code: "130101", name: "KOREAN RAMEN CHEESE 120G", price: 290 },
  { code: "130102", name: "INSTANT NOODLES CHICKEN 75G", price: 130 },
  { code: "130103", name: "KOTTU MEE NOODLES HOT 80G", price: 135 },
  { code: "140101", name: "MILK CHOCOLATE BAR 90G", price: 450 },
  { code: "140102", name: "CHOCOLATE BISCUITS 100G", price: 180 },
  { code: "140103", name: "POTATO CHIPS 60G", price: 350 },
  { code: "140104", name: "MIXED NUTS 100G", price: 520 },
  { code: "150101", name: "COLA PET 1L", price: 330 },
  { code: "150102", name: "ORANGE JUICE TETRA 1L", price: 540 },
  { code: "150103", name: "ENERGY DRINK CAN 250ML", price: 280 },
  { code: "150104", name: "TEA BAGS 50S", price: 700 },
  { code: "150105", name: "COFFEE AGGLOMERATED POUCH 45G", price: 915 },
  { code: "160101", name: "TUNA IN SUNFLOWER OIL 185G", price: 640 },
  { code: "160102", name: "SUNFLOWER OIL 1L", price: 1100 },
  { code: "160103", name: "COCONUT OIL 1L", price: 1850 },
  { code: "160104", name: "RED RICE 5KG", price: 1100 },
  { code: "160105", name: "SUGAR 1KG", price: 310 },
  { code: "160106", name: "DHAL 500G", price: 290 },
  { code: "160107", name: "OATS 500G", price: 690 },
  { code: "160108", name: "ROTI PARATHA 330G", price: 280 },
  { code: "160109", name: "FRENCH FRIES 1KG", price: 780 },
  { code: "170101", name: "TOMATO SAUCE 405G", price: 520 },
  { code: "170102", name: "CHILLI POWDER 100G", price: 160 },
  { code: "170103", name: "SALT 1KG", price: 90 },
  { code: "180101", name: "CHICKEN SAUSAGES 120G", price: 230 },
];
const KEELLS_ALL = [...KEELLS_FRESH, ...KEELLS_BAKERY, ...KEELLS_PACKAGED];

const GLOMARK_PRODUCTS: Product[] = [
  { code: "310201", name: "GARLIC", price: 920, kg: true },
  { code: "310202", name: "POTATOES", price: 350, kg: true },
  { code: "310203", name: "BIG ONIONS", price: 290, kg: true },
  { code: "310204", name: "COCONUT", price: 85 },
  { code: "311201", name: "BANANA AMBUL", price: 360, kg: true },
  { code: "340201", name: "CHICKEN BREAST FRESH", price: 1700, kg: true },
  { code: "340202", name: "CHICKEN LEGS FRESH", price: 1250, kg: true },
  { code: "350201", name: "HAMBURGER BUN", price: 240 },
  { code: "100301", name: "BROWN EGGS LARGE 10S", price: 610 },
  { code: "100302", name: "UHT MILK TETRA 1L", price: 580 },
  { code: "100303", name: "MILK POWDER FULL CREAM 400G", price: 1250 },
  { code: "100304", name: "CHOCOLATE MILK DRINK 1L", price: 1510 },
  { code: "100305", name: "RED RICE 5KG", price: 1100 },
  { code: "100306", name: "SUNFLOWER OIL 1L", price: 1100 },
  { code: "100307", name: "TEA BAGS 100S", price: 1350 },
  { code: "100308", name: "BISCUITS ASSORTED 400G", price: 640 },
  { code: "100309", name: "DETERGENT POWDER 2KG", price: 1480 },
  { code: "100310", name: "TOOTHPASTE 200G", price: 395 },
  { code: "100311", name: "YOGHURT NATURAL 80G", price: 95 },
  { code: "100312", name: "CHEESE SLICES 200G", price: 990 },
  { code: "100313", name: "NOODLES CHICKEN 75G", price: 135 },
  { code: "100314", name: "TOMATO SAUCE 405G", price: 540 },
  { code: "100315", name: "COLA PET 1L", price: 340 },
  { code: "116087", name: "LLDP WHITE CARRIER BAG LARGE", price: 5 },
];

// -------------------------------------------------------------------------------------------------- Keells
const FRESH_PREFIX = new Set(["912", "913", "914", "915", "916", "923", "935"]);
const NTB_CAP = 1500;
const BAG = { code: "77777", name: "Large Polythene Bag", price: 5 };

/** Fictitious. Branch codes are the real Keells codes (public information); everything else is invented. */
const ADDRESS: Record<string, string> = {
  SCK3: "No. 1, Sample Road, Demo Town",
  SCME: "No. 2, Example Lane, Demo City",
  SIAL: "No. 3, Placeholder Street, Demo Bay",
};
const BANKS = ["SEY", "NTB", "COM"] as const;

const money = (x: number): string =>
  x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (q: number): string => (Number.isInteger(q) ? q.toFixed(1) : String(q));

export interface KeellsSpec {
  ref: string;
  /** YYYY-MM-DD */
  date: string;
  storeCode?: keyof typeof ADDRESS;
  /** how many random products to buy (default 3–14) */
  lines?: number;
  /** override the random basket */
  basket?: { product: Product; qty: number }[];
  /** apply the "NTB 25% off on Fresh" promotion (needs the NTB card) */
  ntb?: boolean;
  /** how many lines carry their own deal */
  deals?: number;
  /** pay part with a RewardzPay balance (the bill misspells it "RewadzPay") */
  split?: boolean;
  bag?: boolean;
  /** points printed on the bill before this bill's own points post */
  balanceBefore?: number;
}

export function buildKeellsBill(r: Rng, spec: KeellsSpec): Bill {
  const storeCode = spec.storeCode ?? pick(r, ["SCK3", "SCME", "SIAL"] as const);
  const basket =
    spec.basket ??
    sample(r, KEELLS_ALL, spec.lines ?? int(r, 3, 14)).map((product) => ({
      product,
      qty: product.kg ? int(r, 80, 1900) / 1000 : int(r, 1, 3),
    }));
  const items: BillItem[] = basket.map(({ product, qty }, k) => ({
    line: k + 1,
    code: product.code,
    name: product.name,
    unitPrice: product.price,
    qty,
    amount: round(product.price * qty),
  }));
  if (spec.bag) {
    items.push({
      line: items.length + 1,
      code: BAG.code,
      name: BAG.name,
      unitPrice: BAG.price,
      qty: 1,
      amount: BAG.price,
    });
  }

  const promotions: Promotion[] = [];
  const lineDiscount = new Map<string, number>();
  // line-level deals: the discount is rounded UP to the whole rupee (observed on every fractional case)
  const dealLines = sample(
    r,
    items.filter((i) => i.code !== BAG.code),
    spec.deals ?? (r() < 0.4 ? int(r, 1, 2) : 0),
  );
  const schemes = [
    { scheme: "Nexus Deals 25%", pct: 25 },
    { scheme: "Keells Deals", pct: pick(r, [10, 15, 17] as const) },
  ];
  for (const it of dealLines) {
    const s = pick(r, schemes);
    const amount = Math.ceil(round((it.amount * s.pct) / 100, 4) - 1e-9);
    promotions.push({ scheme: s.scheme, line: it.line as number, code: it.code, pct: s.pct, amount });
    lineDiscount.set(it.code, (lineDiscount.get(it.code) ?? 0) + amount);
  }

  const bank = spec.ntb ? "NTB" : pick(r, BANKS);
  if (spec.ntb) {
    // computed AFTER line deals, on fruit/veg/poultry only (fish is excluded), capped per bill
    const base = round(
      sum(
        items
          .filter((i) => FRESH_PREFIX.has(i.code.slice(0, 3)))
          .map((i) => i.amount - (lineDiscount.get(i.code) ?? 0)),
      ),
    );
    const amount = Math.min(round(base * 0.25), NTB_CAP);
    if (amount > 0)
      promotions.unshift({ scheme: "NTB | 25% off on Fresh", line: null, code: null, pct: null, amount });
  }

  const gross = round(sum(items.map((i) => i.amount)));
  const discount = round(sum(promotions.map((p) => p.amount)));
  const net = round(gross - discount);

  const tenders: Tender[] = [];
  if (spec.split && net > 100) {
    const first = round((int(r, 20, 70) * net) / 100);
    tenders.push(
      { method: "Seylan-RewadzPay-0000", amount: first },
      { method: `Credit Card-${bank}`, amount: round(net - first) },
    );
  } else {
    tenders.push({ method: `Credit Card-${bank}`, amount: net });
  }

  // The renderer groups line deals under their scheme heading, so keep them grouped (bill-level promotions first).
  promotions.sort(
    (a, b) =>
      Number(b.code === null) - Number(a.code === null) ||
      String(a.scheme).localeCompare(String(b.scheme)) ||
      (a.line ?? 0) - (b.line ?? 0),
  );

  const time = `${String(int(r, 9, 21)).padStart(2, "0")}:${String(int(r, 0, 59)).padStart(2, "0")}`;
  const bill: Bill = {
    ref: spec.ref,
    source: "keells",
    date: spec.date,
    time,
    storeCode,
    store: STORE_NAMES[storeCode] ?? storeCode,
    gross,
    discount,
    net,
    pointsEarned: round(net * POINTS_RATE),
    pointsBalancePrinted: spec.balanceBefore ?? round(int(r, 5000, 60000) / 100),
    tenders,
    promotions,
    items,
  };
  return bill;
}

/** Random Keells bill for property tests: any seed gives a bill that reconciles. */
export function generateKeellsBill(seed: number): Bill {
  const r = rng(seed);
  const bill = buildKeellsBill(r, {
    ref: `T${String(seed).padStart(5, "0")}`,
    date: `2026-0${int(r, 1, 9)}-${String(int(r, 1, 28)).padStart(2, "0")}`,
    ntb: r() < 0.25,
    split: r() < 0.25,
    bag: r() < 0.3,
  });
  return { ...bill, rawText: renderEbill(bill, { seed }) };
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stamp = (ymd: string): string =>
  `${ymd.slice(8, 10)}-${MONTH[+ymd.slice(5, 7) - 1]}-${ymd.slice(0, 4)}`;

export interface RenderOptions {
  /** summary layout; default: a wide table row when the bill had no discount, bullets otherwise (as on real bills) */
  layout?: "bullets" | "table";
  /** derives the (invented) till and receipt numbers and the seconds of the timestamp */
  seed?: number;
}

/** The text of a Keells e-bill as the fetched page reads. Tested by parsing it back. */
export function renderEbill(b: Bill, opts: RenderOptions = {}): string {
  const r = rng(opts.seed ?? b.ref.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const layout = opts.layout ?? (b.discount > 0 ? "bullets" : "table");
  const seconds = String(int(r, 0, 59)).padStart(2, "0");
  const lines: string[] = [
    ADDRESS[b.storeCode] ?? "No. 9, Demo Road, Demo Town",
    `0110 000 000 / Store Code: ${b.storeCode}`,
    "",
    `${stamp(b.date)} ${b.time}:${seconds} C:${int(r, 10000000, 99999999)} R:${int(r, 1000000, 9999999)}`,
    "",
    "| Ln | Item | Price | Qty | Amount |",
    "| --- | --- | --- | --- | --- |",
    "|",
    ...b.items.map(
      (i, k) =>
        `| ${i.line ?? k + 1}  | ${i.code}: ${i.name} | ${money(i.unitPrice)} | ${qtyText(i.qty)} | ${money(i.amount)} |`,
    ),
    "",
    "-->",
    "",
  ];

  const labelled: [string, number][] = [["Gross Amount", b.gross]];
  if (b.discount > 0) labelled.push(["Promotion Discount", b.discount]);
  labelled.push(["Net Amount", b.net], ...b.tenders.map((t): [string, number] => [t.method, t.amount]));
  if (layout === "table") {
    for (const [l, v] of labelled) lines.push(`| ${l.padEnd(15)} | | | | | | ${money(v)} |`);
  } else {
    for (const [l, v] of labelled) lines.push(`- ${l} ${money(v)}`);
    if (b.discount > 0) {
      lines.push(`- Total promotion(s) savings ${money(b.discount)}`);
      for (const p of b.promotions.filter((x) => x.code === null))
        lines.push(`- ${p.scheme} ${money(p.amount)}`);
      const bySchemeThenOrder = new Map<string, Promotion[]>();
      for (const p of b.promotions.filter((x) => x.code !== null))
        bySchemeThenOrder.set(p.scheme as string, [...(bySchemeThenOrder.get(p.scheme as string) ?? []), p]);
      for (const [scheme, ps] of bySchemeThenOrder) {
        lines.push(`- ${scheme}`);
        for (const p of ps)
          lines.push(`- ${p.line} ${p.code} ${(p.pct ?? 0).toFixed(2)}% Dis ${money(p.amount)}`);
      }
    }
    lines.push("", "Thank you Customer", "");
  }
  lines.push(`Points earned for this bill: ${(b.pointsEarned ?? 0).toFixed(2)}`, "");
  lines.push(`Total points redeemable as at ${stamp(b.date)} ${money(b.pointsBalancePrinted ?? 0)}`, "");
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------- Glomark
export type GlomarkScheme = "power" | "seylan" | "sampath";
const GLO_LABEL: Record<GlomarkScheme, string> = {
  power: "OTHER PROMOTION - GLOMARK POWER HOURS 25%",
  seylan: "BANK PROMOTION - SEYLAN CC25%",
  sampath: "BANK PROMOTION - SAMPATH BANK CC 25%",
};
const GLO_CARD: Record<GlomarkScheme, string> = {
  power: "Visa Credit Card-0000",
  seylan: "Visa Credit Card-0001",
  sampath: "Visa Credit Card-0002",
};
const SAMPATH_CAP = 2500;

const isBag = (p: Product) => p.code === "116087";
const isMilkStaple = (p: Product) => /UHT|MILK POWDER/.test(p.name);
const isEgg = (p: Product) => /EGG/.test(p.name) && !/MAYONN/.test(p.name);
/** Exclusion lists as inferred from one bill per scheme (docs/rules-evidence.md). */
const EXCLUDED: Record<GlomarkScheme, (p: Product) => boolean> = {
  seylan: (p) => isBag(p),
  power: (p) => isBag(p) || isMilkStaple(p) || isEgg(p),
  sampath: (p) => isBag(p) || isMilkStaple(p) || isEgg(p) || p.code.startsWith("340") || p.name === "COCONUT",
};

export function buildGlomarkReceipt(
  r: Rng,
  opts: {
    ref: string;
    date: string;
    time: string;
    scheme: GlomarkScheme;
    basket: { product: Product; qty: number }[];
  },
): Bill {
  const eligible = opts.basket.filter((b) => !EXCLUDED[opts.scheme](b.product));
  const gross = (b: { product: Product; qty: number }) => round(b.product.price * b.qty);
  const exact = new Map<{ product: Product; qty: number }, number>(
    eligible.map((b) => [b, round(gross(b) * 0.25)]),
  );
  let total = round(sum([...exact.values()]));

  // The cap is applied by truncating ONE line so the bill lands exactly on the cap — not by scaling every line.
  // Which line absorbs it is not predictable from the printed order, so pick a middle one.
  if (opts.scheme === "sampath" && total > SAMPATH_CAP) {
    const order = eligible;
    const victim = order[Math.floor(order.length / 2)];
    const others = round(sum(order.filter((b) => b !== victim).map((b) => exact.get(b) as number)));
    const truncated = round(SAMPATH_CAP - others);
    if (truncated < 0 || truncated > (exact.get(victim) as number))
      throw new Error("demo basket cannot land on the cap by truncating one line");
    exact.set(victim, truncated);
    total = SAMPATH_CAP;
  }

  const lines: ReceiptLineInput[] = opts.basket.map((b, k) => {
    let discount = exact.get(b) ?? 0;
    let scheme: string | null = discount > 0 ? GLO_LABEL[opts.scheme] : null;
    // a line can carry its own, larger promotion on top of the card scheme (observed once: 40% on a bakery item)
    if (opts.scheme === "power" && b.product.code.startsWith("350")) {
      discount = round(gross(b) * 0.4);
      scheme = "MULTIPLE PROMOTION";
    }
    return {
      ln: k + 1,
      code: b.product.code,
      name: b.product.name,
      rate: b.product.price,
      qty: b.qty,
      discount,
      amount: round(gross(b) - discount),
      scheme,
    };
  });
  const g = round(sum(lines.map((l) => round(l.rate * l.qty))));
  const d = round(sum(lines.map((l) => l.discount)));
  const net = round(g - d);
  const input: ReceiptInput = {
    ref: opts.ref,
    source: "glomark",
    store: "Glomark Demo Branch",
    storeCode: "90000",
    date: opts.date,
    time: opts.time,
    // Softlogic points follow no flat rate: printed values are recorded, never derived
    pointsEarned: round(net * (0.0032 + r() * 0.0014)),
    pointsBalancePrinted: int(r, 100, 400),
    loyaltyScheme: "Softlogic One",
    printed: { gross: g, discount: d, net },
    tenders: [{ method: GLO_CARD[opts.scheme], amount: net }],
    lines,
    transcribedFrom: "synthetic demo receipt",
  };
  return buildReceipt(input);
}

// ------------------------------------------------------------------------------------------------ the demo set
/** Lookups are per chain: the same product name has a different code and shelf price at Keells and Glomark. */
const lookup =
  (catalogue: readonly Product[], chain: string) =>
  (name: string): Product => {
    const p = catalogue.find((x) => x.name === name);
    if (!p) throw new Error(`demo ${chain} catalogue has no ${name}`);
    return p;
  };
const PK = lookup(KEELLS_ALL, "Keells");
const PG = lookup(GLOMARK_PRODUCTS, "Glomark");

/** Dates chosen so that three are Sundays (the NTB fresh promotion has only ever been seen on Sundays). */
const KEELLS_DATES = [
  "2026-06-02",
  "2026-06-05",
  "2026-06-07",
  "2026-06-10",
  "2026-06-13",
  "2026-06-16",
  "2026-06-19",
  "2026-06-24",
  "2026-06-28",
  "2026-07-01",
  "2026-07-04",
  "2026-07-08",
  "2026-07-11",
  "2026-07-15",
  "2026-07-19",
  "2026-07-22",
  "2026-07-25",
  "2026-08-01",
  "2026-08-05",
  "2026-08-12",
  "2026-08-16",
];
/** Index → spend (Rs) that happened before that bill but produced no e-bill here: the points chain breaks. */
const MISSING_SPEND: Record<number, number> = { 5: 3500, 12: 8200 };
/** Index → bonus points credited before that bill (a break too large to be a basket: > Rs 30,000 implied). */
const BONUS_POINTS: Record<number, number> = { 16: 500 };

export const DEMO_REFS = {
  /** Keells, bullets layout, two tenders (RewadzPay), two line deals */
  rich: "DEM003",
  /** Keells, wide-table layout, no discount */
  plain: "DEM001",
  /** Keells, Sunday, NTB fresh promotion below the cap */
  ntb: "DEM003",
  /** Keells, Sunday, NTB fresh promotion at the Rs 1,500 cap */
  ntbCapped: "DEM015",
  glomarkPower: "GLO900001",
  glomarkSeylan: "GLO900002",
  glomarkSampath: "GLO900003",
} as const;

export function demoBills(): Bill[] {
  const r = rng(20260601);
  const out: Bill[] = [];
  let balance = 120;
  let prevEarned = 0;
  KEELLS_DATES.forEach((date, i) => {
    if (i > 0) balance = round(balance + prevEarned);
    if (MISSING_SPEND[i]) balance = round(balance + MISSING_SPEND[i] * POINTS_RATE);
    if (BONUS_POINTS[i]) balance = round(balance + BONUS_POINTS[i]);
    const ref = `DEM${String(i + 1).padStart(3, "0")}`;
    const special: Partial<KeellsSpec> =
      ref === "DEM001"
        ? {
            basket: [
              { product: PK("SANDWICH BREAD 450G"), qty: 1 },
              { product: PK("FULL CREAM UHT MILK 1L"), qty: 2 },
            ],
            deals: 0,
            split: false,
          }
        : ref === "DEM003"
          ? { ntb: true, deals: 2, split: true, bag: true, lines: 11 }
          : ref === "DEM009"
            ? { ntb: true, deals: 1, lines: 9 }
            : ref === "DEM015"
              ? {
                  ntb: true,
                  deals: 0,
                  basket: [
                    { product: PK("CHICKEN BREAST FRESH"), qty: 1.9 },
                    { product: PK("CHICKEN LEGS FRESH"), qty: 1.6 },
                    { product: PK("TOMATOES"), qty: 1.4 },
                    { product: PK("BIG ONIONS"), qty: 2.2 },
                    { product: PK("MANGO"), qty: 1.1 },
                    { product: PK("THALAPATH FRESH FISH"), qty: 0.9 },
                    { product: PK("MIXED NUTS 100G"), qty: 2 },
                  ],
                }
              : {};
    const bill = buildKeellsBill(r, { ref, date, balanceBefore: balance, ...special });
    prevEarned = bill.pointsEarned as number;
    out.push({ ...bill, rawText: renderEbill(bill, { seed: i + 1 }) });
  });

  const basket = (names: [string, number][]) => names.map(([n, q]) => ({ product: PG(n), qty: q }));
  out.push(
    buildGlomarkReceipt(r, {
      ref: "GLO900001",
      date: "2026-06-17",
      time: "18:56",
      scheme: "power",
      basket: basket([
        ["GARLIC", 0.182],
        ["POTATOES", 1.4],
        ["BROWN EGGS LARGE 10S", 1],
        ["UHT MILK TETRA 1L", 6],
        ["HAMBURGER BUN", 2],
        ["RED RICE 5KG", 2],
        ["TEA BAGS 100S", 1],
        ["LLDP WHITE CARRIER BAG LARGE", 2],
        ["DETERGENT POWDER 2KG", 1],
      ]),
    }),
    buildGlomarkReceipt(r, {
      ref: "GLO900002",
      date: "2026-07-09",
      time: "19:49",
      scheme: "seylan",
      basket: basket([
        ["GARLIC", 0.3],
        ["BIG ONIONS", 1.1],
        ["COCONUT", 3],
        ["MILK POWDER FULL CREAM 400G", 2],
        ["SUNFLOWER OIL 1L", 2],
        ["BISCUITS ASSORTED 400G", 3],
        ["LLDP WHITE CARRIER BAG LARGE", 1],
      ]),
    }),
    buildGlomarkReceipt(r, {
      ref: "GLO900003",
      date: "2026-08-08",
      time: "22:40",
      scheme: "sampath",
      basket: basket([
        ["CHICKEN BREAST FRESH", 2.4],
        ["CHICKEN LEGS FRESH", 2.1],
        ["COCONUT", 4],
        ["BROWN EGGS LARGE 10S", 3],
        ["UHT MILK TETRA 1L", 8],
        ["CHOCOLATE MILK DRINK 1L", 1],
        ["RED RICE 5KG", 2],
        ["SUNFLOWER OIL 1L", 2],
        ["TEA BAGS 100S", 1],
        ["BISCUITS ASSORTED 400G", 2],
        ["CHEESE SLICES 200G", 1],
        ["TOOTHPASTE 200G", 2],
      ]),
    }),
  );
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
