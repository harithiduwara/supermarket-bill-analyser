/** User settings. Pure over Storage-like objects so it is testable without a browser.
 *
 * The API key is a secret (ADR-0004): it lives in sessionStorage (cleared when the tab
 * closes) unless the user explicitly opts in to "remember on this device"
 * (localStorage). The model name is not secret.
 */
import { DEFAULT_MODEL } from "./domain/ocr";

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = "anthropic_api_key";
const MODEL = "anthropic_model";
const LAST_EXPORT = "last_export_at";

// Storage can throw (private windows, blocked site data); the app must still work.
const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export class Settings {
  constructor(
    private readonly session: KV,
    private readonly local: KV,
    private readonly envModel?: string,
  ) {}

  getApiKey(): { key: string; remembered: boolean } {
    const s = safe(() => this.session.getItem(KEY), null);
    if (s) return { key: s, remembered: false };
    const l = safe(() => this.local.getItem(KEY), null);
    return { key: l ?? "", remembered: l !== null };
  }

  /** Stores the key for this tab; also on this device only if `remember` is true. */
  setApiKey(key: string, remember: boolean): void {
    const k = key.trim();
    if (!k) return this.clearApiKey();
    safe(() => this.session.setItem(KEY, k), undefined);
    if (remember) safe(() => this.local.setItem(KEY, k), undefined);
    else safe(() => this.local.removeItem(KEY), undefined);
  }

  clearApiKey(): void {
    safe(() => this.session.removeItem(KEY), undefined);
    safe(() => this.local.removeItem(KEY), undefined);
  }

  getModel(): string {
    return safe(() => this.local.getItem(MODEL), null) || this.envModel || DEFAULT_MODEL;
  }
  setModel(model: string): void {
    safe(() => this.local.setItem(MODEL, model.trim()), undefined);
  }

  getLastExport(): Date | null {
    const v = safe(() => this.local.getItem(LAST_EXPORT), null);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }
  markExported(at: Date = new Date()): void {
    safe(() => this.local.setItem(LAST_EXPORT, at.toISOString()), undefined);
  }
}

export const settings = new Settings(
  safe(() => sessionStorage, memoryKV()),
  safe(() => localStorage, memoryKV()),
  import.meta.env.VITE_ANTHROPIC_MODEL as string | undefined,
);

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** Backup reminder (US-06): due once changes the USER made — bills added or imported — have gone
 * unexported for `days`. Demo bills are reproducible from the app, so it never triggers a nag.
 * `unexportedSince` is the time of the oldest change not covered by the last export, or null if none. */
export function backupDue(unexportedSince: Date | null, now: Date = new Date(), days = 14): boolean {
  if (!unexportedSince) return false;
  return now.getTime() - unexportedSince.getTime() > days * 86_400_000;
}

/** An event that actually changed the ledger: a bill added, or an import that added at least one. */
const isChange = (e: { type: string; detail?: string }): boolean =>
  e.type === "added" || (e.type === "import" && !/(^|[ :])0 added\b/.test(e.detail ?? ""));

/** Oldest user change (added/import) after the last export; null if everything is exported. */
export function oldestUnexportedChange(
  events: { type: string; at: string; detail?: string }[],
  lastExport: Date | null,
): Date | null {
  const times = events
    .filter(isChange)
    .map((e) => new Date(e.at))
    .filter((d) => !lastExport || d > lastExport)
    .sort((a, b) => a.getTime() - b.getTime());
  return times[0] ?? null;
}
