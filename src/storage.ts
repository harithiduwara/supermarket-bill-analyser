/** Persistent-storage helpers. Without persistence the browser may evict IndexedDB under
 * storage pressure — for a ledger that exists only in the browser, that is data loss (R-2). */
export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!s) return { supported: false, persisted: false, usageBytes: null, quotaBytes: null };
  const [persisted, est] = await Promise.all([
    s.persisted?.().catch(() => false) ?? false,
    s.estimate?.().catch(() => undefined),
  ]);
  return { supported: true, persisted, usageBytes: est?.usage ?? null, quotaBytes: est?.quota ?? null };
}

/** Ask the browser to protect the ledger from eviction. Returns whether it is now persistent. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
