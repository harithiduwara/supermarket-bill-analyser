import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DexieStore } from "../db/db";
import type { Bill } from "../domain/types";
import { requestPersistence } from "../storage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon } from "./components/Icon";
import { ThemeToggle } from "./components/ThemeToggle";
import { useToasts } from "./components/Toasts";
import { AppContext } from "./context";
import { href, useRoute, type Route } from "./router";
import { ActivityPage } from "./pages/ActivityPage";
import { BillPage } from "./pages/BillPage";
import { EbillPage } from "./pages/EbillPage";
import { LedgerPage } from "./pages/LedgerPage";
import { WorkbookPage } from "./pages/WorkbookPage";
import { ReceiptPage } from "./pages/ReceiptPage";
import { SettingsPage } from "./pages/SettingsPage";

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: string;
  match: Route["name"][];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Records",
    items: [
      { to: href.workbook, label: "Workbook", short: "Workbook", icon: "workbook", match: ["workbook"] },
      { to: href.ledger, label: "Ledger", short: "Ledger", icon: "ledger", match: ["ledger", "bill"] },
    ],
  },
  {
    group: "Capture",
    items: [
      { to: href.receipt, label: "Add receipt", short: "Receipt", icon: "camera", match: ["receipt"] },
      { to: href.ebill, label: "Add e-bill", short: "E-bill", icon: "receipt", match: ["ebill"] },
    ],
  },
  {
    group: "System",
    items: [
      { to: href.activity, label: "Activity", short: "Activity", icon: "activity", match: ["activity"] },
      { to: href.settings, label: "Settings", short: "Settings", icon: "settings", match: ["settings"] },
    ],
  },
];

const TITLES: Record<Route["name"], string> = {
  workbook: "Workbook",
  ledger: "Ledger",
  bill: "Bill",
  ebill: "Add Keells e-bill",
  receipt: "Add photo receipt",
  activity: "Activity",
  settings: "Settings & backup",
  notfound: "Page not found",
};

export function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}

function Shell() {
  const store = useMemo(() => new DexieStore(), []);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [fatal, setFatal] = useState("");
  const { toast, view: toastView } = useToasts();
  const route = useRoute();

  const refresh = useCallback(async () => setBills(await store.all()), [store]);

  // The ledger starts EMPTY. Nothing is preloaded: a visitor either imports their own workbook or chooses to load
  // the (synthetic) demo bills on the Workbook page.
  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (e) {
        setFatal((e as Error).message);
      }
    })();
  }, [refresh]);

  // After any save: reload, and (once) ask the browser to protect the data from eviction.
  const afterSave = useCallback(async () => {
    await refresh();
    if ((await store.getMeta("persist-asked")) !== "1") {
      await store.setMeta("persist-asked", "1");
      await requestPersistence();
    }
  }, [refresh, store]);

  // Move focus to the page heading and update the title on navigation (keyboard + screen-reader users).
  // Re-runs when the ledger finishes loading, because the heading only exists after that.
  // Focus moves to the page heading only when the user navigates to a different route — not on first
  // load (that would put the skip link behind the heading in tab order) and not when the ledger
  // merely finishes loading.
  const loaded = bills !== null;
  const lastRoute = useRef<string | null>(null);
  const routeKey = JSON.stringify(route);
  useEffect(() => {
    document.title = `${TITLES[route.name]} · Grocery ledger`;
    if (lastRoute.current !== null && lastRoute.current !== routeKey) {
      document.getElementById("page-title")?.focus();
    }
    lastRoute.current = routeKey;
  }, [route, routeKey, loaded]);

  const ctx = useMemo(
    () => (bills ? { store, bills, refresh, toast } : null),
    [store, bills, refresh, toast],
  );

  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("page-title")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app">
        <aside className="side">
          <a className="brand" href={href.workbook}>
            <span className="logo" aria-hidden="true">
              <Icon name="receipt" size={18} />
            </span>
            Grocery ledger
          </a>
          <nav className="primary" aria-label="Primary">
            {NAV.map((g) => (
              <div className="nav-group" key={g.group}>
                <p className="nav-label" aria-hidden="true">
                  {g.group}
                </p>
                {g.items.map((n) => (
                  <a key={n.to} href={n.to} aria-current={n.match.includes(route.name) ? "page" : undefined}>
                    <Icon name={n.icon} />
                    {/* two labels, switched by CSS: the hidden one leaves the accessibility tree, so the visible text is the name */}
                    <span className="long">{n.label}</span>
                    <span className="short">{n.short}</span>
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <p className="side-stat">
              <span className={`dot${bills && bills.length ? " on" : ""}`} aria-hidden="true" />
              {bills ? `Ledger: ${bills.length} ${bills.length === 1 ? "bill" : "bills"}` : "Ledger: loading"}
            </p>
            <p className="side-note">
              <Icon name="lock" size={14} /> Stored on this device only
            </p>
          </div>
        </aside>
        <div className="content">
          <header className="topbar">
            <a className="brand mobile-brand" href={href.workbook}>
              Grocery ledger
            </a>
            <ThemeToggle />
          </header>
          <main id="main">
            {fatal && (
              <div className="banner bad" role="alert">
                <strong>The ledger could not be opened.</strong> {fatal}
              </div>
            )}
            {!ctx ? (
              fatal ? null : (
                <div role="status" className="loading">
                  <p>Loading your ledger…</p>
                  <div className="skeleton" aria-hidden="true" />
                  <div className="skeleton short" aria-hidden="true" />
                </div>
              )
            ) : (
              <AppContext.Provider value={ctx}>
                {route.name === "workbook" && <WorkbookPage onChanged={afterSave} />}
                {route.name === "ledger" && <LedgerPage />}
                {route.name === "bill" && <BillPage billRef={route.ref} />}
                {route.name === "ebill" && <EbillPage onSaved={afterSave} />}
                {route.name === "receipt" && <ReceiptPage onSaved={afterSave} />}
                {route.name === "activity" && <ActivityPage />}
                {route.name === "settings" && <SettingsPage onChanged={afterSave} />}
                {route.name === "notfound" && (
                  <div className="card empty">
                    <h1 id="page-title" tabIndex={-1} style={{ fontSize: "1.2rem" }}>
                      Page not found
                    </h1>
                    <p>
                      <a href={href.ledger}>Back to the ledger</a>
                    </p>
                  </div>
                )}
              </AppContext.Provider>
            )}
          </main>
        </div>
      </div>
      {toastView}
    </>
  );
}
