/** Photo -> draft receipt via the Anthropic Messages API, called straight from
 * the browser (the site is static, so there is no server to hold a key).
 *
 * The result is only ever a DRAFT. It is shown in an editable table and nothing
 * is saved until every reconciliation check passes (OCR is the weak point).
 * Unreadable fields come back null — the model is told not to guess.
 */
export interface OcrLine {
  ln: number | null;
  code: string | null;
  name: string | null;
  rate: number | null;
  qty: number | null;
  discount: number | null;
  amount: number | null;
  scheme: string | null;
}
export interface OcrDraft {
  store: string | null;
  storeCode: string | null;
  ticket: string | null;
  date: string | null;
  time: string | null;
  printedGross: number | null;
  printedDiscount: number | null;
  printedNet: number | null;
  pointsEarned: number | null;
  pointsBalance: number | null;
  loyaltyScheme: string | null;
  tenders: { method: string; amount: number }[];
  lines: OcrLine[];
}
export interface MergeResult {
  draft: OcrDraft;
  conflicts: string[];
}

const nullableNum = { type: ["number", "null"] };
const nullableStr = { type: ["string", "null"] };

export const RECEIPT_TOOL = {
  name: "record_receipt",
  description: "Record exactly what is printed on the supermarket receipt photo.",
  input_schema: {
    type: "object",
    properties: {
      store: nullableStr,
      store_code: nullableStr,
      ticket: nullableStr,
      date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      time: { type: ["string", "null"], description: "HH:MM, 24h" },
      printed_gross: nullableNum,
      printed_discount: nullableNum,
      printed_net: nullableNum,
      points_earned: nullableNum,
      points_balance: nullableNum,
      loyalty_scheme: nullableStr,
      tenders: {
        type: "array",
        items: {
          type: "object",
          properties: { method: { type: "string" }, amount: { type: "number" } },
          required: ["method", "amount"],
        },
      },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ln: { ...nullableNum, description: "printed line number" },
            code: nullableStr,
            name: nullableStr,
            rate: nullableNum,
            qty: nullableNum,
            discount: { ...nullableNum, description: "positive number, 0 if none printed" },
            amount: { ...nullableNum, description: "post-discount line amount as printed" },
            scheme: { ...nullableStr, description: "promotion label printed for the line, if any" },
          },
          required: ["ln", "code", "name", "rate", "qty", "discount", "amount", "scheme"],
        },
      },
    },
    required: [
      "store",
      "store_code",
      "ticket",
      "date",
      "time",
      "printed_gross",
      "printed_discount",
      "printed_net",
      "points_earned",
      "points_balance",
      "loyalty_scheme",
      "tenders",
      "lines",
    ],
  },
} as const;

export const OCR_SYSTEM =
  "You transcribe supermarket receipt photos. Copy every figure exactly as printed. " +
  "Never calculate, correct, estimate or fill in a value: if a character or field is " +
  "unreadable, or the photo does not show it (e.g. totals when only the top half is " +
  "visible), return null for it. Include every line item visible, with its printed line " +
  "number. Report discounts as positive numbers. Do not skip faded lines.";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

interface Cfg {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function transcribeImage(img: Blob, cfg: Cfg): Promise<OcrDraft> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: cfg.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      // required for calls straight from a browser; the key never leaves this device
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 8000,
      system: OCR_SYSTEM,
      tools: [RECEIPT_TOOL],
      tool_choice: { type: "tool", name: RECEIPT_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.type || "image/jpeg", data: await blobToBase64(img) },
            },
            { type: "text", text: "Transcribe this receipt." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const block = (Array.isArray(body.content) ? body.content : []).find(
    (c: { type?: string }) => c.type === "tool_use",
  );
  if (!block) throw new Error("the model returned no transcription");
  return fromToolInput(block.input);
}

// The model's output is untrusted: coerce each field defensively and never throw.
// Anything that is not the expected type becomes null — i.e. "unreadable", which
// the confirmation table turns into a blank the user must fill.
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asStr = (v: unknown, max = 200): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export const MAX_OCR_LINES = 500;

export function fromToolInput(input: unknown): OcrDraft {
  const i = obj(input);
  const lines = (Array.isArray(i.lines) ? i.lines : []).slice(0, MAX_OCR_LINES).map((raw): OcrLine => {
    const l = obj(raw);
    return {
      ln: asNum(l.ln),
      code: asStr(l.code, 40),
      name: asStr(l.name),
      rate: asNum(l.rate),
      qty: asNum(l.qty),
      discount: asNum(l.discount),
      amount: asNum(l.amount),
      scheme: asStr(l.scheme),
    };
  });
  const tenders = (Array.isArray(i.tenders) ? i.tenders : []).slice(0, 10).flatMap((raw) => {
    const t = obj(raw);
    const method = asStr(t.method, 100);
    const amount = asNum(t.amount);
    return method && amount !== null ? [{ method, amount }] : [];
  });
  return {
    store: asStr(i.store, 100),
    storeCode: asStr(i.store_code, 40),
    ticket: asStr(i.ticket, 40),
    date: asStr(i.date, 10),
    time: asStr(i.time, 5),
    printedGross: asNum(i.printed_gross),
    printedDiscount: asNum(i.printed_discount),
    printedNet: asNum(i.printed_net),
    pointsEarned: asNum(i.points_earned),
    pointsBalance: asNum(i.points_balance),
    loyaltyScheme: asStr(i.loyalty_scheme, 100),
    tenders,
    lines,
  };
}

/** Merge drafts from overlapping photos of one receipt. Lines are de-duplicated
 * on LINE NUMBER, never position. If two photos disagree on a line, the first
 * is kept and the disagreement is reported so the user resolves it. */
export function mergeDrafts(drafts: OcrDraft[]): MergeResult {
  const conflicts: string[] = [];
  const first = <K extends keyof OcrDraft>(k: K): OcrDraft[K] =>
    (drafts.map((d) => d[k]).find((v) => v !== null && v !== undefined) ?? null) as OcrDraft[K];

  const byLn = new Map<number, OcrLine>();
  const unnumbered: OcrLine[] = [];
  drafts.forEach((d, di) => {
    for (const l of d.lines) {
      if (l.ln === null || l.ln === undefined) {
        unnumbered.push(l);
        continue;
      }
      const prev = byLn.get(l.ln);
      if (!prev) {
        byLn.set(l.ln, l);
        continue;
      }
      const diffs = (["code", "name", "rate", "qty", "discount", "amount"] as const).filter(
        (f) => prev[f] !== l[f] && l[f] !== null && prev[f] !== null,
      );
      if (diffs.length) {
        conflicts.push(
          `line ${l.ln}: photo ${di + 1} disagrees on ${diffs.join(", ")} — kept the first photo's reading`,
        );
      }
    }
  });
  const lines = [...byLn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, l]) => l)
    .concat(unnumbered);
  if (unnumbered.length)
    conflicts.push(`${unnumbered.length} line(s) had no readable line number and could not be de-duplicated`);

  const seen = new Set<string>();
  const tenders = drafts
    .flatMap((d) => d.tenders)
    .filter((t) => {
      const k = `${t.method}|${t.amount}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });

  return {
    conflicts,
    draft: {
      store: first("store"),
      storeCode: first("storeCode"),
      ticket: first("ticket"),
      date: first("date"),
      time: first("time"),
      printedGross: first("printedGross"),
      printedDiscount: first("printedDiscount"),
      printedNet: first("printedNet"),
      pointsEarned: first("pointsEarned"),
      pointsBalance: first("pointsBalance"),
      loyaltyScheme: first("loyaltyScheme"),
      tenders,
      lines,
    },
  };
}
