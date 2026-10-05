import Dexie, { type Table } from "dexie";
import type { LedgerStore } from "../domain/store";
import type { AuditEvent, Bill } from "../domain/types";

interface ImageRow {
  id?: number;
  ref: string;
  blob: Blob;
}
interface MetaRow {
  key: string;
  value: string;
}

/** Browser-local ledger (IndexedDB). Single user, single device: back it up
 * with Export — clearing site data deletes it. */
class Db extends Dexie {
  bills!: Table<Bill, string>;
  images!: Table<ImageRow, number>;
  meta!: Table<MetaRow, string>;
  events!: Table<AuditEvent, number>;
  constructor(name = "grocery-ledger") {
    super(name);
    this.version(1).stores({ bills: "ref, date, source", images: "++id, ref", meta: "key" });
    // v2: append-only audit log. Additive, so existing bills are untouched (tests/unit/migration.test.ts).
    this.version(2).stores({ events: "++id, at, ref" });
  }
}

export class DexieStore implements LedgerStore {
  private db: Db;
  constructor(name?: string) {
    this.db = new Db(name);
  }
  async has(ref: string) {
    return (await this.db.bills.get(ref)) !== undefined;
  }
  get(ref: string) {
    return this.db.bills.get(ref);
  }
  async add(bill: Bill, images: Blob[] = []) {
    await this.db.transaction("rw", this.db.bills, this.db.images, async () => {
      if (await this.db.bills.get(bill.ref)) throw new Error(`${bill.ref} already in ledger`);
      await this.db.bills.add(bill); // add() never overwrites
      for (const blob of images) await this.db.images.add({ ref: bill.ref, blob });
    });
  }
  async remove(refs: string[]) {
    await this.db.transaction("rw", this.db.bills, this.db.images, async () => {
      await this.db.bills.bulkDelete(refs);
      await this.db.images.where("ref").anyOf(refs).delete();
    });
  }
  all() {
    return this.db.bills.orderBy("date").toArray();
  }
  async images(ref: string) {
    return (await this.db.images.where("ref").equals(ref).toArray()).map((r) => r.blob);
  }
  async log(e: Omit<AuditEvent, "id" | "at">, at: Date = new Date()) {
    await this.db.events.add({ ...e, at: at.toISOString() });
  }
  async events(limit = 500) {
    return this.db.events.orderBy("id").reverse().limit(limit).toArray();
  }
  async getMeta(key: string) {
    return (await this.db.meta.get(key))?.value;
  }
  async setMeta(key: string, value: string) {
    await this.db.meta.put({ key, value });
  }
}
