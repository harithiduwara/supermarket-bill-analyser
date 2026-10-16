import Dexie, { type Table } from "dexie";
import type { LedgerStore } from "../domain/store";
import type { AuditEvent, Bill } from "../domain/types";
import { open, openJson, recordId, seal, sealJson, type KeyPair, type Sealed } from "./crypto";

interface Row extends Sealed {
  id: string;
}
interface ImageRow extends Sealed {
  n?: number;
  rid: string;
}
interface EventRow extends Sealed {
  n?: number;
}

class Db extends Dexie {
  bills!: Table<Row, string>;
  images!: Table<ImageRow, number>;
  events!: Table<EventRow, number>;
  meta!: Table<Row, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ bills: "id", images: "++n, rid", events: "++n", meta: "id" });
  }
}

export const profileDbName = (profileId: string) => `grocery-ledger-p-${profileId}`;

/**
 * The ledger for one signed-in profile. Same contract as `DexieStore`, but every value is AES-GCM sealed and every
 * record id is an HMAC, so the IndexedDB contents reveal only how many records exist. The browser keeps whole
 * records in memory only while the profile is unlocked.
 */
export class EncryptedStore implements LedgerStore {
  private db: Db;
  constructor(
    private profileId: string,
    private keys: KeyPair,
  ) {
    this.db = new Db(profileDbName(profileId));
  }
  private ctx = (table: string, id = "") => `${this.profileId}|${table}|${id}`;
  private id = (table: string, ref: string) => recordId(this.keys.mac, table, ref);

  async has(ref: string) {
    return (await this.db.bills.get(await this.id("bills", ref))) !== undefined;
  }
  async get(ref: string) {
    const id = await this.id("bills", ref);
    const row = await this.db.bills.get(id);
    return row ? openJson<Bill>(this.keys.enc, this.ctx("bills", id), row) : undefined;
  }
  async add(bill: Bill, images: Blob[] = []) {
    const id = await this.id("bills", bill.ref);
    const rid = await this.id("images", bill.ref);
    const sealedBill = { id, ...(await sealJson(this.keys.enc, this.ctx("bills", id), bill)) };
    const sealedImages = await Promise.all(images.map((b) => this.sealBlob(rid, b)));
    await this.db.transaction("rw", this.db.bills, this.db.images, async () => {
      if (await this.db.bills.get(id)) throw new Error(`${bill.ref} already in ledger`);
      await this.db.bills.add(sealedBill); // add() never overwrites
      for (const s of sealedImages) await this.db.images.add({ rid, ...s });
    });
  }
  async remove(refs: string[]) {
    const ids = await Promise.all(refs.map((r) => this.id("bills", r)));
    const rids = await Promise.all(refs.map((r) => this.id("images", r)));
    await this.db.transaction("rw", this.db.bills, this.db.images, async () => {
      await this.db.bills.bulkDelete(ids);
      await this.db.images.where("rid").anyOf(rids).delete();
    });
  }
  async all() {
    const rows = await this.db.bills.toArray();
    const bills = await Promise.all(
      rows.map((r) => openJson<Bill>(this.keys.enc, this.ctx("bills", r.id), r)),
    );
    return bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ref < b.ref ? -1 : 1));
  }
  async images(ref: string) {
    const rid = await this.id("images", ref);
    const rows = await this.db.images.where("rid").equals(rid).toArray();
    return Promise.all(rows.map((r) => this.openBlob(rid, r)));
  }
  async log(e: Omit<AuditEvent, "id" | "at">, at: Date = new Date()) {
    const s = await sealJson(this.keys.enc, this.ctx("events"), { ...e, at: at.toISOString() });
    await this.db.events.add(s);
  }
  async events(limit = 500) {
    const rows = await this.db.events.orderBy("n").reverse().limit(limit).toArray();
    return Promise.all(
      rows.map(async (r) => ({
        ...(await openJson<Omit<AuditEvent, "id">>(this.keys.enc, this.ctx("events"), r)),
        id: r.n,
      })),
    );
  }
  async getMeta(key: string) {
    const id = await this.id("meta", key);
    const row = await this.db.meta.get(id);
    return row ? (await openJson<{ v: string }>(this.keys.enc, this.ctx("meta", id), row)).v : undefined;
  }
  async setMeta(key: string, value: string) {
    const id = await this.id("meta", key);
    await this.db.meta.put({ id, ...(await sealJson(this.keys.enc, this.ctx("meta", id), { v: value })) });
  }

  // A photo is stored as: 4-byte header length, JSON header { type }, then the bytes — all sealed together.
  private async sealBlob(rid: string, blob: Blob): Promise<Sealed> {
    const header = new TextEncoder().encode(JSON.stringify({ type: blob.type }));
    const body = new Uint8Array(await blob.arrayBuffer());
    const framed = new Uint8Array(4 + header.length + body.length);
    new DataView(framed.buffer).setUint32(0, header.length);
    framed.set(header, 4);
    framed.set(body, 4 + header.length);
    return seal(this.keys.enc, this.ctx("images", rid), framed);
  }
  private async openBlob(rid: string, s: Sealed): Promise<Blob> {
    const framed = await open(this.keys.enc, this.ctx("images", rid), s);
    const hl = new DataView(framed.buffer, framed.byteOffset).getUint32(0);
    const { type } = JSON.parse(new TextDecoder().decode(framed.subarray(4, 4 + hl))) as { type: string };
    return new Blob([framed.slice(4 + hl)], { type });
  }

  close() {
    this.db.close();
  }
  /** Delete this profile's data from the device. */
  static async destroy(profileId: string) {
    await Dexie.delete(profileDbName(profileId));
  }
}
