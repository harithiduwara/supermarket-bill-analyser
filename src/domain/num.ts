/** Python-compatible round(x, 2): correct rounding of the stored double, with
 * exact binary ties (0.125, 0.375 …) going to the even cent, as Python does.
 * Math.round / toFixed would differ on those ties. */
export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  const y = x * f;
  const fl = Math.floor(y);
  const diff = y - fl;
  let r: number;
  if (diff === 0.5) r = fl % 2 === 0 ? fl : fl + 1;
  else r = Math.round(y);
  return r / f;
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

// Cached: Number.prototype.toLocaleString builds a formatter on every call, which made
// reconcile() ~10x slower on a 5,000-bill ledger.
const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (x: number): string => fmt.format(x);
