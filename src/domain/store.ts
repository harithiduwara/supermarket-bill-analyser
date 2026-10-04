import type { Bill } from "./types";

/** Persistence boundary. The ledger is the source of truth; nothing derived is stored. */
export interface LedgerStore {
  has(ref: string): Promise<boolean>;
  get(ref: string): Promise<Bill | undefined>;
  /** insert only — callers check `has` first; never overwrites */
  add(bill: Bill, images?: Blob[]): Promise<void>;
  all(): Promise<Bill[]>;
  images(ref: string): Promise<Blob[]>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
}

export class MemoryStore implements LedgerStore {
  private bills = new Map<string, Bill>();
  private imgs = new Map<string, Blob[]>();
  private meta = new Map<string, string>();
  async has(ref: string) { return this.bills.has(ref); }
  async get(ref: string) { return this.bills.get(ref); }
  async add(bill: Bill, images: Blob[] = []) {
    if (this.bills.has(bill.ref)) throw new Error(`${bill.ref} already in ledger`);
    this.bills.set(bill.ref, structuredClone(bill));
    if (images.length) this.imgs.set(bill.ref, images);
  }
  async all() { return [...this.bills.values()]; }
  async images(ref: string) { return this.imgs.get(ref) ?? []; }
  async getMeta(k: string) { return this.meta.get(k); }
  async setMeta(k: string, v: string) { this.meta.set(k, v); }
}
