import { createContext, useContext } from "react";
import type { LedgerStore } from "../domain/store";
import type { Bill } from "../domain/types";
import type { Session, Vault } from "../vault/vault";

export type ToastKind = "ok" | "bad";
export interface AppCtx {
  store: LedgerStore;
  /** the unlocked profile, the vault that manages it, and a way to lock it */
  session: Session;
  vault: Vault;
  lock: () => void;
  /** minutes of inactivity before locking, and a way to change it */
  autolock: number;
  setAutolock: (minutes: number) => Promise<void>;
  bills: Bill[];
  refresh: () => Promise<void>;
  toast: (message: string, kind?: ToastKind) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error("useApp outside <AppContext.Provider>");
  return c;
}
