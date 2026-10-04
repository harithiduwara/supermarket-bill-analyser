import { createContext, useContext } from "react";
import type { LedgerStore } from "../domain/store";
import type { Bill } from "../domain/types";

export type ToastKind = "ok" | "bad";
export interface AppCtx {
  store: LedgerStore;
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
