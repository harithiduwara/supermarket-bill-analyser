/**
 * Cryptographic primitives for encrypted profiles (ADR-0008). WebCrypto only: no third-party crypto code.
 *
 *   password ──PBKDF2-SHA256 (600k)──▶ KEK ──wraps──▶ { enc key (AES-GCM-256), mac key (HMAC-SHA-256) }
 *   recovery key ──HKDF-SHA256──▶ KEK' ──wraps──▶ the same two keys
 *
 * Records are sealed with AES-GCM under the enc key, with the record's location bound in as additional data, so
 * a ciphertext copied to another record (or another profile) fails to open. Record ids are HMACs, so stored ids
 * do not reveal bill references. After unwrapping, the keys are non-extractable CryptoKeys: script can use them
 * while the profile is unlocked but cannot read them out.
 */

export const KDF_ITERATIONS = 600_000; // OWASP guidance for PBKDF2-HMAC-SHA256

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = (): SubtleCrypto => {
  if (!globalThis.crypto?.subtle)
    throw new Error("This browser has no WebCrypto, so encrypted profiles cannot be used.");
  return globalThis.crypto.subtle;
};

export interface Sealed {
  iv: Uint8Array;
  ct: Uint8Array;
}
export interface KeyPair {
  enc: CryptoKey;
  mac: CryptoKey;
}
export interface WrappedKeys {
  enc: Sealed;
  mac: Sealed;
}

/** The secret (password or recovery key) did not open the keys — or the data was altered. Never says which. */
export class WrongSecretError extends Error {
  constructor() {
    super("Wrong email, password or recovery key.");
    this.name = "WrongSecretError";
  }
}

export const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const utf8 = (s: string): Uint8Array => enc.encode(s);
export const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b instanceof Uint8Array ? b : b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// BufferSource typing differs between TS lib versions; the bytes are what matter.
const bs = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

const AES = { name: "AES-GCM", length: 256 } as const;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;

/** Password → key-encryption key. Slow on purpose: this is the only defence against offline guessing. */
export async function passwordKek(
  password: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", bs(utf8(password.normalize("NFKC"))), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations },
    base,
    AES,
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** The recovery key is 160 random bits, so a fast KDF is enough. */
export async function recoveryKek(recoveryBytes: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", bs(recoveryBytes), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(utf8("grocery-ledger/recovery/v1")) },
    base,
    AES,
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Fresh random profile keys. Extractable only so they can be wrapped once; use `unwrapKeys` to get working copies. */
export async function newKeys(): Promise<KeyPair> {
  return {
    enc: await subtle().generateKey(AES, true, ["encrypt", "decrypt"]),
    mac: await subtle().generateKey({ ...HMAC, length: 256 }, true, ["sign"]),
  };
}

async function wrapOne(key: CryptoKey, kek: CryptoKey): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().wrapKey("raw", key, kek, { name: "AES-GCM", iv: bs(iv) }));
  return { iv, ct };
}
export async function wrapKeys(keys: KeyPair, kek: CryptoKey): Promise<WrappedKeys> {
  return { enc: await wrapOne(keys.enc, kek), mac: await wrapOne(keys.mac, kek) };
}

/** Open wrapped keys. A wrong secret fails the AES-GCM tag check and raises `WrongSecretError`. */
export async function unwrapKeys(w: WrappedKeys, kek: CryptoKey, extractable = false): Promise<KeyPair> {
  try {
    return {
      enc: await subtle().unwrapKey(
        "raw",
        bs(w.enc.ct),
        kek,
        { name: "AES-GCM", iv: bs(w.enc.iv) },
        AES,
        extractable,
        ["encrypt", "decrypt"],
      ),
      mac: await subtle().unwrapKey(
        "raw",
        bs(w.mac.ct),
        kek,
        { name: "AES-GCM", iv: bs(w.mac.iv) },
        HMAC,
        extractable,
        ["sign"],
      ),
    };
  } catch {
    throw new WrongSecretError();
  }
}

/** Re-open the keys as non-extractable working copies (used right after creation). */
export async function workingCopy(keys: KeyPair): Promise<KeyPair> {
  const kek = await subtle().generateKey(AES, false, ["wrapKey", "unwrapKey"]);
  return unwrapKeys(await wrapKeys(keys, kek), kek);
}

export async function seal(key: CryptoKey, context: string, plain: Uint8Array): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: bs(iv), additionalData: bs(utf8(context)) },
      key,
      bs(plain),
    ),
  );
  return { iv, ct };
}
export async function open(key: CryptoKey, context: string, s: Sealed): Promise<Uint8Array> {
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: bs(s.iv), additionalData: bs(utf8(context)) },
        key,
        bs(s.ct),
      ),
    );
  } catch {
    throw new Error("A stored record could not be decrypted: it was altered, or belongs to another profile.");
  }
}
export const sealJson = (key: CryptoKey, context: string, value: unknown) =>
  seal(key, context, utf8(JSON.stringify(value)));
export async function openJson<T>(key: CryptoKey, context: string, s: Sealed): Promise<T> {
  return JSON.parse(dec.decode(await open(key, context, s))) as T;
}

/** Deterministic, non-reversible record id: stored ids do not reveal bill references. */
export async function recordId(mac: CryptoKey, table: string, ref: string): Promise<string> {
  return hex(await subtle().sign("HMAC", mac, bs(utf8(`${table}\0${ref}`))));
}

/** Lookup key for sign-in. Reveals only a hash of the email to someone reading the browser's storage. */
export async function emailHash(email: string): Promise<string> {
  return hex(await subtle().digest("SHA-256", bs(utf8(`grocery-ledger/email/v1\0${normaliseEmail(email)}`))));
}
export const normaliseEmail = (email: string): string => email.trim().normalize("NFKC").toLowerCase();

// ── recovery key text: 32 characters (160 bits) in groups of 4, Crockford base32 (no I, L, O, U) ──
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function encodeRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out.match(/.{1,4}/g)!.join("-");
}

/** Accepts any grouping, case, and the usual look-alikes (O→0, I/L→1). Returns undefined if malformed. */
export function decodeRecoveryKey(text: string): Uint8Array | undefined {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 32) return undefined;
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return undefined;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}

export const newRecoveryBytes = (): Uint8Array => randomBytes(20);
