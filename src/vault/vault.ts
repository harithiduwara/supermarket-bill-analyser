import type { LedgerStore } from "../domain/store";
import {
  WrongSecretError,
  decodeRecoveryKey,
  emailHash,
  encodeRecoveryKey,
  newKeys,
  newRecoveryBytes,
  normaliseEmail,
  openJson,
  passwordKek,
  randomBytes,
  recoveryKek,
  sealJson,
  unwrapKeys,
  workingCopy,
  wrapKeys,
  hex,
  KDF_ITERATIONS,
  type KeyPair,
} from "./crypto";
import { EncryptedStore } from "./encryptedStore";
import { passwordProblem } from "./policy";
import { Registry, type ProfileRow } from "./registry";

/** An unlocked profile. Dropping every reference to it is what "lock" means. */
export interface Session {
  profileId: string;
  email: string;
  keys: KeyPair;
  store: EncryptedStore;
}

export class VaultError extends Error {}

const labelCtx = (id: string) => `${id}|profile|`;
const TAB_KEY = "vault-tab";
export const DEFAULT_AUTOLOCK_MIN = 15;
export const AUTOLOCK_CHOICES = [5, 15, 30, 60] as const;

/** The bit of sessionStorage the vault uses: it dies with the tab, which is what makes a session "this tab only". */
export interface TabStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
const noTab: TabStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

export class Vault {
  constructor(
    readonly registry = new Registry(),
    private tab: TabStorage = typeof sessionStorage === "undefined" ? noTab : sessionStorage,
  ) {}

  hasProfiles = async () => (await this.registry.count()) > 0;

  private async open(row: ProfileRow, keys: KeyPair): Promise<Session> {
    const { email } = await openJson<{ email: string }>(keys.enc, labelCtx(row.id), row.label);
    return { profileId: row.id, email, keys, store: new EncryptedStore(row.id, keys) };
  }

  /** Create a profile. Returns the recovery key, which is shown once and never stored in readable form. */
  async register(email: string, password: string): Promise<{ session: Session; recoveryKey: string }> {
    const addr = normaliseEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new VaultError("Enter a valid email address.");
    const problem = passwordProblem(password, addr);
    if (problem) throw new VaultError(problem);
    const hash = await emailHash(addr);
    if (await this.registry.byEmailHash(hash))
      throw new VaultError("A profile for this email already exists on this device. Sign in instead.");

    const id = hex(randomBytes(12));
    const salt = randomBytes(16);
    const recoverySalt = randomBytes(16);
    const recoveryBytes = newRecoveryBytes();
    const fresh = await newKeys();
    const row: ProfileRow = {
      id,
      emailHash: hash,
      createdAt: new Date().toISOString(),
      salt,
      iterations: KDF_ITERATIONS,
      byPassword: await wrapKeys(fresh, await passwordKek(password, salt)),
      recoverySalt,
      byRecovery: await wrapKeys(fresh, await recoveryKek(recoveryBytes, recoverySalt)),
      label: await sealJson(fresh.enc, labelCtx(id), { email: addr }),
    };
    await this.registry.put(row);
    return {
      session: await this.open(row, await workingCopy(fresh)),
      recoveryKey: encodeRecoveryKey(recoveryBytes),
    };
  }

  /** Sign in. An unknown email and a wrong password are indistinguishable, in the message and in the time taken. */
  async signIn(email: string, password: string): Promise<Session> {
    const row = await this.registry.byEmailHash(await emailHash(email));
    if (!row) {
      await passwordKek(password, randomBytes(16)); // spend the same time as a real attempt
      throw new WrongSecretError();
    }
    const keys = await unwrapKeys(row.byPassword, await passwordKek(password, row.salt, row.iterations));
    return this.open(row, keys);
  }

  /** Forgot the password: the recovery key opens the keys, then a new password and a NEW recovery key replace the old. */
  async recover(
    email: string,
    recoveryKey: string,
    newPassword: string,
  ): Promise<{ session: Session; recoveryKey: string }> {
    const problem = passwordProblem(newPassword, email);
    if (problem) throw new VaultError(problem);
    const row = await this.registry.byEmailHash(await emailHash(email));
    const bytes = decodeRecoveryKey(recoveryKey);
    if (!row || !bytes) throw new WrongSecretError();
    const keys = await unwrapKeys(row.byRecovery, await recoveryKek(bytes, row.recoverySalt), true);
    return this.rewrap(row, keys, newPassword);
  }

  async changePassword(s: Session, current: string, next: string): Promise<{ recoveryKey: string }> {
    const row = await this.rowFor(s);
    await unwrapKeys(row.byPassword, await passwordKek(current, row.salt, row.iterations)); // proves it is them
    const problem = passwordProblem(next, s.email);
    if (problem) throw new VaultError(problem);
    return { recoveryKey: (await this.rewrap(row, await this.extractable(row, current), next)).recoveryKey };
  }

  /** Replace the recovery key (the old one stops working). Needs the current password. */
  async newRecoveryKey(s: Session, password: string): Promise<string> {
    const row = await this.rowFor(s);
    const fresh = await this.extractable(row, password);
    const recoveryBytes = newRecoveryBytes();
    const recoverySalt = randomBytes(16);
    await this.registry.put({
      ...row,
      recoverySalt,
      byRecovery: await wrapKeys(fresh, await recoveryKek(recoveryBytes, recoverySalt)),
    });
    return encodeRecoveryKey(recoveryBytes);
  }

  /** Delete the profile and every stored record. Needs the password; cannot be undone. */
  async remove(s: Session, password: string): Promise<void> {
    const row = await this.rowFor(s);
    await unwrapKeys(row.byPassword, await passwordKek(password, row.salt, row.iterations));
    s.store.close();
    await EncryptedStore.destroy(s.profileId);
    await this.registry.delete(s.profileId);
    this.forgetTab();
  }

  // ── a tab's unlocked session survives a reload, but not closing the tab, and expires when idle ──

  async remember(s: Session, ttlMinutes: number): Promise<void> {
    let token = this.tab.getItem(TAB_KEY);
    if (!token) {
      token = hex(randomBytes(16));
      this.tab.setItem(TAB_KEY, token);
    }
    await this.registry.db.resume.put({
      token,
      profileId: s.profileId,
      keys: s.keys,
      expiresAt: Date.now() + ttlMinutes * 60_000,
    });
  }

  async resume(): Promise<Session | undefined> {
    try {
      await this.registry.db.resume.where("expiresAt").below(Date.now()).delete();
      const token = this.tab.getItem(TAB_KEY);
      if (!token) return undefined;
      const r = await this.registry.db.resume.get(token);
      const row = r && (await this.registry.get(r.profileId));
      if (!r || !row) return undefined;
      return await this.open(row, r.keys);
    } catch {
      return undefined; // any failure means "locked": the user signs in again
    }
  }

  /** Lock: forget this tab's session. The profile's data stays, sealed. */
  async lock(s?: Session): Promise<void> {
    s?.store.close();
    await this.forgetTab();
  }
  private async forgetTab() {
    const token = this.tab.getItem(TAB_KEY);
    this.tab.removeItem(TAB_KEY);
    if (token) await this.registry.db.resume.delete(token).catch(() => undefined);
  }

  async autolockMinutes(): Promise<number> {
    const v = Number(await this.registry.getSetting("autolock-minutes"));
    return (AUTOLOCK_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_AUTOLOCK_MIN;
  }
  setAutolockMinutes = (m: number) => this.registry.setSetting("autolock-minutes", String(m));

  // ── internals ──
  private async rowFor(s: Session): Promise<ProfileRow> {
    const row = await this.registry.get(s.profileId);
    if (!row) throw new VaultError("This profile no longer exists on this device.");
    return row;
  }
  /** Re-open the keys extractably (needs the password) so they can be wrapped again under a new secret. */
  private async extractable(row: ProfileRow, password: string): Promise<KeyPair> {
    // The working keys are non-extractable by design. Changing the password re-wraps them, so unwrap them
    // extractably here, from the password-wrapped copy, for the length of this call only.
    const kek = await passwordKek(password, row.salt, row.iterations);
    return unwrapKeys(row.byPassword, kek, true);
  }
  private async rewrap(
    row: ProfileRow,
    keys: KeyPair,
    newPassword: string,
  ): Promise<{ session: Session; recoveryKey: string }> {
    const salt = randomBytes(16);
    const recoverySalt = randomBytes(16);
    const recoveryBytes = newRecoveryBytes();
    const next: ProfileRow = {
      ...row,
      salt,
      iterations: KDF_ITERATIONS,
      byPassword: await wrapKeys(keys, await passwordKek(newPassword, salt)),
      recoverySalt,
      byRecovery: await wrapKeys(keys, await recoveryKek(recoveryBytes, recoverySalt)),
    };
    await this.registry.put(next);
    return {
      session: await this.open(next, await workingCopy(keys)),
      recoveryKey: encodeRecoveryKey(recoveryBytes),
    };
  }
}

export type { LedgerStore };
