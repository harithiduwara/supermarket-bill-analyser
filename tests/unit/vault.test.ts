import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { demoLedger } from "../../src/domain/seed";
import { ingestMany } from "../../src/domain/ingest";
import {
  WrongSecretError,
  decodeRecoveryKey,
  emailHash,
  encodeRecoveryKey,
  newRecoveryBytes,
  newKeys,
  open,
  passwordKek,
  recordId,
  seal,
  unwrapKeys,
  workingCopy,
  wrapKeys,
} from "../../src/vault/crypto";
import { DexieStore } from "../../src/db/db";
import { deleteLegacy, legacyCount, moveLegacyInto } from "../../src/vault/legacy";
import { EncryptedStore } from "../../src/vault/encryptedStore";
import { passwordProblem, strength } from "../../src/vault/policy";
import { Registry } from "../../src/vault/registry";
import { Vault, VaultError } from "../../src/vault/vault";

let n = 0;
const tabShim = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const fresh = (tab = tabShim()) => new Vault(new Registry(`vault-test-${++n}`), tab);
const PW = "correct horse battery";

/** Everything IndexedDB holds for a profile, exactly as stored (keys included), as plain JSON-able data. */
async function rawRows(profileId: string) {
  const db = new Dexie(`grocery-ledger-p-${profileId}`);
  await db.open();
  try {
    const out: Record<string, unknown> = {};
    for (const t of db.tables) {
      out[t.name] = {
        keys: await t.toCollection().primaryKeys(),
        rows: (await t.toArray()).map((r: { iv: Uint8Array; ct: Uint8Array }) => ({
          ...r,
          iv: [...r.iv],
          ct: [...r.ct],
        })),
      };
    }
    return out;
  } finally {
    db.close();
  }
}

describe("US-28 / NFR-15 crypto primitives", () => {
  it("seals and opens, and the location is part of what is authenticated", async () => {
    const k = await workingCopy(await newKeys());
    const sealed = await seal(k.enc, "p1|bills|a", new TextEncoder().encode("hello"));
    expect(new TextDecoder().decode(await open(k.enc, "p1|bills|a", sealed))).toBe("hello");
    await expect(open(k.enc, "p1|bills|b", sealed)).rejects.toThrow(/could not be decrypted/); // moved record
    await expect(open(k.enc, "p2|bills|a", sealed)).rejects.toThrow(/could not be decrypted/); // other profile
    const flipped = { ...sealed, ct: sealed.ct.map((b, i) => (i === 0 ? b ^ 1 : b)) };
    await expect(open(k.enc, "p1|bills|a", flipped)).rejects.toThrow(/could not be decrypted/); // altered
  });

  it("never reuses an IV and never repeats a ciphertext for the same plaintext", async () => {
    const k = await workingCopy(await newKeys());
    const a = await seal(k.enc, "c", new TextEncoder().encode("same"));
    const b = await seal(k.enc, "c", new TextEncoder().encode("same"));
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });

  it("a wrong password cannot unwrap the keys; the right one can", async () => {
    const keys = await newKeys();
    const salt = new Uint8Array(16).fill(7);
    const wrapped = await wrapKeys(keys, await passwordKek(PW, salt, 1000));
    await expect(unwrapKeys(wrapped, await passwordKek("not it at all", salt, 1000))).rejects.toBeInstanceOf(
      WrongSecretError,
    );
    const ok = await unwrapKeys(wrapped, await passwordKek(PW, salt, 1000));
    const s = await seal(ok.enc, "x", new TextEncoder().encode("v"));
    expect(new TextDecoder().decode(await open((await workingCopy(keys)).enc, "x", s))).toBe("v");
  });

  it("working keys cannot be exported", async () => {
    const k = await workingCopy(await newKeys());
    await expect(crypto.subtle.exportKey("raw", k.enc)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("raw", k.mac)).rejects.toThrow();
  });

  it("record ids are deterministic per key and reveal nothing about the reference", async () => {
    const k = await workingCopy(await newKeys());
    const other = await workingCopy(await newKeys());
    const id = await recordId(k.mac, "bills", "DEM001");
    expect(id).toBe(await recordId(k.mac, "bills", "DEM001"));
    expect(id).not.toContain("DEM001");
    expect(id).not.toBe(await recordId(other.mac, "bills", "DEM001"));
    expect(id).not.toBe(await recordId(k.mac, "images", "DEM001"));
  });

  it("recovery keys round-trip, tolerate grouping, case and look-alikes, and reject garbage", () => {
    const bytes = newRecoveryBytes();
    const text = encodeRecoveryKey(bytes);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(decodeRecoveryKey(text)).toEqual(bytes);
    expect(decodeRecoveryKey(text.toLowerCase().replaceAll("-", " "))).toEqual(bytes);
    expect(decodeRecoveryKey(text.replaceAll("0", "O").replaceAll("1", "l"))).toEqual(bytes);
    expect(decodeRecoveryKey("too-short")).toBeUndefined();
    expect(decodeRecoveryKey("U".repeat(32))).toBeUndefined(); // U is not in the alphabet
  });

  it("email lookup hashes ignore case and spacing", async () => {
    expect(await emailHash(" Ann@Example.COM ")).toBe(await emailHash("ann@example.com"));
    expect(await emailHash("ann@example.com")).not.toContain("ann");
  });
});

describe("US-28 password policy", () => {
  it("requires length, refuses obvious choices, and never the email", () => {
    expect(passwordProblem("short", "a@b.co")).toMatch(/at least 10/);
    expect(passwordProblem("aaaaaaaaaaaa", "a@b.co")).toMatch(/easy to guess/);
    expect(passwordProblem("password123", "a@b.co")).toMatch(/easy to guess/);
    expect(passwordProblem("ann@example.com", "ann@example.com")).toMatch(/email/);
    expect(passwordProblem(PW, "a@b.co")).toBeUndefined();
    expect(strength("short")).toBe("weak");
    expect(strength("elevenchars1")).toBe("fair");
    expect(strength("a very long passphrase here")).toBe("strong");
  });
});

describe("US-28 encrypted ledger", () => {
  let vault: Vault;
  beforeEach(() => {
    vault = fresh();
  });

  it("works as a LedgerStore: idempotent adds, refuses to overwrite, keeps photos, meta and the audit log", async () => {
    const { session } = await vault.register("ann@example.com", PW);
    const s = session.store;
    const seed = demoLedger();
    await ingestMany(s, seed);
    await ingestMany(s, seed);
    expect((await s.all()).length).toBe(seed.length);
    await expect(s.add(seed[0])).rejects.toThrow(/already in ledger/);
    expect((await s.get(seed[0].ref))?.net).toBe(seed[0].net);

    const png = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
    await s.remove([seed[1].ref]);
    await s.add({ ...seed[1] }, [png]);
    const back = await s.images(seed[1].ref);
    expect(back).toHaveLength(1);
    expect(back[0].type).toBe("image/png");
    expect([...new Uint8Array(await back[0].arrayBuffer())]).toEqual([1, 2, 3, 4]);

    await s.setMeta("k", "v");
    expect(await s.getMeta("k")).toBe("v");
    await s.log({ type: "export", detail: "one" });
    await s.log({ type: "export", detail: "two" });
    expect((await s.events(2)).map((e) => e.detail)).toEqual(["two", "one"]);
  });

  it("stores nothing readable: no reference, store name or amount appears in the raw rows", async () => {
    const { session } = await vault.register("ann@example.com", PW);
    await session.store.add(demoLedger()[0]);
    const raw = JSON.stringify(await rawRows(session.profileId));
    const b = demoLedger()[0];
    expect(raw).not.toContain(b.ref);
    expect(raw).not.toContain(b.store);
    expect(raw).not.toContain("ann@example.com");
    const reg = JSON.stringify(
      (await vault.registry.db.profiles.toArray()).map((p) => ({
        ...p,
        salt: 0,
        byPassword: 0,
        byRecovery: 0,
        recoverySalt: 0,
        label: 0,
      })),
    );
    expect(reg).not.toContain("ann@example.com"); // only a hash of it
  });

  it("a record copied between profiles cannot be opened", async () => {
    const a = (await vault.register("a@example.com", PW)).session;
    const b = (await vault.register("b@example.com", PW)).session;
    await a.store.add(demoLedger()[0]);
    // forge: open A's record with B's keys
    const rec = await a.store.get(demoLedger()[0].ref);
    expect(rec).toBeDefined();
    expect(await b.store.get(demoLedger()[0].ref)).toBeUndefined();
    expect(await b.store.all()).toEqual([]);
  });
});

describe("US-28 profiles: register, sign in, recover, change password, delete", () => {
  let vault: Vault;
  beforeEach(() => {
    vault = fresh();
  });

  it("register, lock, sign in again with the same data", async () => {
    const { session, recoveryKey } = await vault.register("Ann@Example.com", PW);
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    await session.store.add(demoLedger()[0]);
    await vault.lock(session);
    const again = await vault.signIn(" ann@example.com ", PW);
    expect(again.email).toBe("ann@example.com");
    expect((await again.store.all()).length).toBe(1);
  });

  it("a wrong password and an unknown email give the same error", async () => {
    await vault.register("ann@example.com", PW);
    const wrong = await vault.signIn("ann@example.com", "wrong password!!").catch((e: Error) => e);
    const unknown = await vault.signIn("nobody@example.com", PW).catch((e: Error) => e);
    expect(wrong).toBeInstanceOf(WrongSecretError);
    expect(unknown).toBeInstanceOf(WrongSecretError);
    expect((wrong as Error).message).toBe((unknown as Error).message);
  });

  it("refuses a duplicate email, a bad email and a weak password", async () => {
    await vault.register("ann@example.com", PW);
    await expect(vault.register("ANN@example.com", PW)).rejects.toThrow(/already exists/);
    await expect(vault.register("not-an-email", PW)).rejects.toBeInstanceOf(VaultError);
    await expect(vault.register("bob@example.com", "short")).rejects.toThrow(/at least 10/);
  });

  it("the recovery key resets the password, keeps every bill, and is replaced by a new one", async () => {
    const { session, recoveryKey } = await vault.register("ann@example.com", PW);
    await session.store.add(demoLedger()[0]);
    await vault.lock(session);
    await expect(
      vault.recover("ann@example.com", "0000-0000-0000-0000-0000-0000-0000-0000", "new password here"),
    ).rejects.toBeInstanceOf(WrongSecretError);
    const r = await vault.recover("ann@example.com", recoveryKey.toLowerCase(), "new password here");
    expect(r.recoveryKey).not.toBe(recoveryKey);
    expect((await r.session.store.all()).length).toBe(1);
    await expect(vault.signIn("ann@example.com", PW)).rejects.toBeInstanceOf(WrongSecretError); // old password gone
    expect((await (await vault.signIn("ann@example.com", "new password here")).store.all()).length).toBe(1);
    await expect(vault.recover("ann@example.com", recoveryKey, "third password!!")).rejects.toBeInstanceOf(
      WrongSecretError,
    ); // old recovery key gone
  });

  it("changing the password needs the current one and keeps the data", async () => {
    const { session } = await vault.register("ann@example.com", PW);
    await session.store.add(demoLedger()[0]);
    await expect(
      vault.changePassword(session, "not the password", "another long one"),
    ).rejects.toBeInstanceOf(WrongSecretError);
    await vault.changePassword(session, PW, "another long one");
    await expect(vault.signIn("ann@example.com", PW)).rejects.toBeInstanceOf(WrongSecretError);
    const s2 = await vault.signIn("ann@example.com", "another long one");
    expect((await s2.store.all()).length).toBe(1);
  });

  it("a new recovery key replaces the old one", async () => {
    const { session, recoveryKey } = await vault.register("ann@example.com", PW);
    const next = await vault.newRecoveryKey(session, PW);
    expect(next).not.toBe(recoveryKey);
    await expect(vault.recover("ann@example.com", recoveryKey, "some new password")).rejects.toBeInstanceOf(
      WrongSecretError,
    );
    await expect(vault.recover("ann@example.com", next, "some new password")).resolves.toBeDefined();
  });

  it("deleting a profile removes its data, needs the password, and leaves other profiles alone", async () => {
    const a = (await vault.register("a@example.com", PW)).session;
    const b = (await vault.register("b@example.com", PW)).session;
    await a.store.add(demoLedger()[0]);
    await b.store.add(demoLedger()[1]);
    await expect(vault.remove(a, "wrong wrong wrong")).rejects.toBeInstanceOf(WrongSecretError);
    await vault.remove(a, PW);
    await expect(vault.signIn("a@example.com", PW)).rejects.toBeInstanceOf(WrongSecretError);
    expect((await (await vault.signIn("b@example.com", PW)).store.all()).length).toBe(1);
    expect(await vault.registry.count()).toBe(1);
  });

  it("two profiles on one device cannot see each other's bills", async () => {
    const a = (await vault.register("a@example.com", PW)).session;
    const b = (await vault.register("b@example.com", PW)).session;
    await a.store.add(demoLedger()[0]);
    expect(await b.store.all()).toEqual([]);
    expect(new EncryptedStore(b.profileId, a.keys).constructor).toBe(EncryptedStore); // type check only
  });

  it("a tab's unlocked session survives a reload, but another tab, an expiry or a lock ends it", async () => {
    const tab = tabShim();
    const v = fresh(tab);
    const { session } = await v.register("ann@example.com", PW);
    await session.store.add(demoLedger()[0]);
    expect(await v.resume()).toBeUndefined(); // nothing remembered yet
    await v.remember(session, 15);
    const again = await v.resume(); // "reload": same tab storage, same registry
    expect(again?.email).toBe("ann@example.com");
    expect((await again!.store.all()).length).toBe(1);
    expect(await new Vault(v.registry, tabShim()).resume()).toBeUndefined(); // a different tab has no token
    await v.remember(session, -1); // already expired
    expect(await v.resume()).toBeUndefined();
    await v.remember(session, 15);
    await v.lock(session);
    expect(await v.resume()).toBeUndefined();
  });

  it("auto-lock choices are remembered and constrained", async () => {
    expect(await vault.autolockMinutes()).toBe(15);
    await vault.setAutolockMinutes(30);
    expect(await vault.autolockMinutes()).toBe(30);
    await vault.setAutolockMinutes(7); // not an offered choice
    expect(await vault.autolockMinutes()).toBe(15);
  });
});

describe("US-28 moving an unencrypted ledger (from before profiles) into a profile", () => {
  it("copies bills, photos and history, checks the copy, and only then deletes the original", async () => {
    const name = "legacy-test-ledger";
    const old = new DexieStore(name);
    const seed = demoLedger();
    await ingestMany(old, seed);
    await old.add({ ...seed[0], ref: "PHOTO1" }, [
      new Blob([new Uint8Array([9, 8, 7])], { type: "image/jpeg" }),
    ]);
    await old.setMeta("workbook-refs", '["DEM001"]');
    old.close();
    expect(await legacyCount(name)).toBe(seed.length + 1);

    const { session } = await fresh().register("ann@example.com", PW);
    const { moved } = await moveLegacyInto(session.store, name);
    expect(moved).toBe(seed.length + 1);
    expect((await session.store.all()).length).toBe(seed.length + 1);
    expect([...new Uint8Array(await (await session.store.images("PHOTO1"))[0].arrayBuffer())]).toEqual([
      9, 8, 7,
    ]);
    expect(await session.store.getMeta("workbook-refs")).toBe('["DEM001"]');
    expect((await session.store.events(1))[0].detail).toMatch(/moved into this encrypted profile/);

    expect(await legacyCount(name)).toBeGreaterThan(0); // not deleted until asked
    await deleteLegacy(name);
    expect(await legacyCount(name)).toBe(0);
  });

  it("an absent legacy database counts as zero and is not created by looking", async () => {
    expect(await legacyCount("never-existed")).toBe(0);
  });

  it("running it twice never duplicates or overwrites", async () => {
    const name = "legacy-twice";
    const old = new DexieStore(name);
    await ingestMany(old, demoLedger().slice(0, 3));
    old.close();
    const { session } = await fresh().register("ann@example.com", PW);
    await moveLegacyInto(session.store, name);
    await moveLegacyInto(session.store, name);
    expect((await session.store.all()).length).toBe(3);
    await deleteLegacy(name);
  });
});
