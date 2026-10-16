import { useSyncExternalStore } from "react";

/** Hash routing: works on GitHub Pages without server rewrites, gives every screen a stable link,
 * and makes the browser Back button behave. */
export type Route =
  | { name: "workbook" }
  | { name: "ledger" }
  | { name: "bill"; ref: string }
  | { name: "ebill" }
  | { name: "receipt" }
  | { name: "activity" }
  | { name: "settings" }
  | { name: "notfound" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const [a, b] = path.split("/");
  if (path === "" || a === "workbook") return { name: "workbook" };
  if (a === "ledger") return { name: "ledger" };
  if (a === "bill" && b) {
    try {
      return { name: "bill", ref: decodeURIComponent(b) };
    } catch {
      return { name: "notfound" };
    }
  }
  if (a === "add" && b === "ebill") return { name: "ebill" };
  if (a === "add" && b === "receipt") return { name: "receipt" };
  if (a === "activity") return { name: "activity" };
  if (a === "settings") return { name: "settings" };
  return { name: "notfound" };
}

export const href = {
  workbook: "#/",
  ledger: "#/ledger",
  bill: (ref: string) => `#/bill/${encodeURIComponent(ref)}`,
  ebill: "#/add/ebill",
  receipt: "#/add/receipt",
  activity: "#/activity",
  settings: "#/settings",
};

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const snapshot = () => window.location.hash;

export function useRoute(): Route {
  return parseHash(useSyncExternalStore(subscribe, snapshot, () => ""));
}
