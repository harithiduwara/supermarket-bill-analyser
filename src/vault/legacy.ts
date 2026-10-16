import Dexie from "dexie";
import { DexieStore } from "../db/db";
import type { LedgerStore } from "../domain/store";

/** Name of the original, unencrypted ledger database (before profiles existed). */
export const LEGACY_DB = "grocery-ledger";

/** How many bills sit unencrypted in this browser from before profiles. 0 when there is none. */
export async function legacyCount(name = LEGACY_DB): Promise<number> {
  try {
    if (!(await Dexie.exists(name))) return 0;
  } catch {
    return 0;
  }
  const s = new DexieStore(name);
  try {
    return (await s.all()).length;
  } finally {
    s.close();
  }
}

/**
 * Copy the unencrypted ledger into `to`, check it arrived, then delete the original. Bills already in `to` are kept
 * as they are (never overwritten). The original is deleted only after the copy is verified.
 */
export async function moveLegacyInto(to: LedgerStore, name = LEGACY_DB): Promise<{ moved: number }> {
  const from = new DexieStore(name);
  try {
    const bills = await from.all();
    for (const b of bills) {
      if (await to.has(b.ref)) continue;
      await to.add(b, await from.images(b.ref));
    }
    for (const b of bills)
      if (!(await to.has(b.ref))) throw new Error(`Copy check failed for ${b.ref}; nothing was deleted.`);
    for (const key of ["workbook-refs", "persist-asked"]) {
      const v = await from.getMeta(key);
      if (v !== undefined && (await to.getMeta(key)) === undefined) await to.setMeta(key, v);
    }
    for (const e of (await from.events(100000)).reverse()) {
      const { id: _id, at, ...rest } = e;
      void _id;
      await to.log(rest, new Date(at));
    }
    await to.log({ type: "import", detail: `${bills.length} bills moved into this encrypted profile` });
    return { moved: bills.length };
  } finally {
    from.close();
  }
  // deletion happens in deleteLegacy so that the caller decides when
}

export async function deleteLegacy(name = LEGACY_DB): Promise<void> {
  await Dexie.delete(name);
}
