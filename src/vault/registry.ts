import Dexie, { type Table } from "dexie";
import type { KeyPair, Sealed, WrappedKeys } from "./crypto";

/** One row per profile on this device. Everything sensitive is sealed or wrapped; nothing here is a secret. */
export interface ProfileRow {
  id: string;
  /** hex SHA-256 of the normalised email: used only to find the profile at sign-in */
  emailHash: string;
  createdAt: string;
  salt: Uint8Array;
  iterations: number;
  byPassword: WrappedKeys;
  recoverySalt: Uint8Array;
  byRecovery: WrappedKeys;
  /** `{ email }` sealed under the profile's enc key, so the address is shown only after sign-in */
  label: Sealed;
}

/** A tab's unlocked session: non-extractable keys, usable only while this tab's token matches. */
export interface ResumeRow {
  token: string;
  profileId: string;
  keys: KeyPair;
  expiresAt: number;
}

interface MetaRow {
  key: string;
  value: string;
}

class VaultDb extends Dexie {
  profiles!: Table<ProfileRow, string>;
  resume!: Table<ResumeRow, string>;
  meta!: Table<MetaRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ profiles: "id, emailHash", resume: "token, profileId, expiresAt", meta: "key" });
  }
}

export class Registry {
  readonly db: VaultDb;
  constructor(name = "grocery-ledger-vault") {
    this.db = new VaultDb(name);
  }
  count = () => this.db.profiles.count();
  byEmailHash = (h: string) => this.db.profiles.where("emailHash").equals(h).first();
  get = (id: string) => this.db.profiles.get(id);
  put = (row: ProfileRow) => this.db.profiles.put(row);
  delete = async (id: string) => {
    await this.db.profiles.delete(id);
    await this.db.resume.where("profileId").equals(id).delete();
  };
  async getSetting(key: string): Promise<string | undefined> {
    return (await this.db.meta.get(key))?.value;
  }
  async setSetting(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value });
  }
  close = () => this.db.close();
}
