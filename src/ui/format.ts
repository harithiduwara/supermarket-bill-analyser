import { money } from "../domain/num";

const dt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const d = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const rs = (x: number): string => `Rs ${money(x)}`;
export const fmtDateTime = (iso: string): string => dt.format(new Date(iso));
export const fmtDate = (ymd: string): string => d.format(new Date(`${ymd}T00:00:00`));
export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
export const monthLabel = (ym: string): string =>
  new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    new Date(`${ym}-01T00:00:00`),
  );
