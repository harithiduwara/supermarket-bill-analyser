import { useEffect, useMemo, useState } from "react";
import { defaultQuery, queryLedger, type LedgerQuery, type SortKey } from "../../domain/ledgerView";
import { backupDue, oldestUnexportedChange, settings } from "../../settings";
import { DemoBanner } from "../components/DemoBanner";
import { FloorCaveat } from "../components/FloorCaveat";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useApp } from "../context";
import { fmtDate, monthLabel, pct, rs } from "../format";
import { href } from "../router";

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "ref", label: "Ref" },
  { key: "store", label: "Store" },
  { key: "lines", label: "Lines", num: true },
  { key: "gross", label: "Gross (Rs)", num: true },
  { key: "discount", label: "Discount (Rs)", num: true },
  { key: "net", label: "Net (Rs)", num: true },
];

export function LedgerPage() {
  const { bills, store } = useApp();
  const [q, setQ] = useState<LedgerQuery>(defaultQuery);
  // Open by default on desktop; collapsed on phones so the bills are what you see first.
  const [filtersOpen, setFiltersOpen] = useState(() => window.matchMedia("(min-width: 721px)").matches);
  const set = (patch: Partial<LedgerQuery>) => setQ((p) => ({ ...p, limit: defaultQuery.limit, ...patch }));
  const view = useMemo(() => queryLedger(bills, q), [bills, q]);
  const t = view.totals;
  const filtered = q.text || q.source !== "all" || q.month !== "all";
  const [remindBackup, setRemindBackup] = useState(false);
  useEffect(() => {
    let live = true;
    void store.events(1000).then((ev) => {
      if (live) setRemindBackup(backupDue(oldestUnexportedChange(ev, settings.getLastExport())));
    });
    return () => {
      live = false;
    };
  }, [store, bills]);

  const toggleSort = (key: SortKey) =>
    set({ sort: key, dir: q.sort === key && q.dir === "desc" ? "asc" : "desc" });
  const ariaSort = (key: SortKey) =>
    q.sort === key ? (q.dir === "asc" ? "ascending" : "descending") : "none";

  return (
    <>
      <PageHeader
        title="Ledger"
        lead="Every bill was reconciled before it was saved. Figures are as printed."
        actions={
          <span className="row hide-sm">
            <a className="btn primary" href={href.receipt}>
              Add photo receipt
            </a>
            <a className="btn" href={href.ebill}>
              Add Keells e-bill
            </a>
          </span>
        }
      />

      <DemoBanner />
      {remindBackup && (
        <div className="banner info" role="note">
          <strong>Update your workbook.</strong> It has been over 14 days since you added bills that are not
          in an exported workbook. <a href={href.workbook}>Export now</a>
        </div>
      )}
      {t.failing > 0 && (
        <div className="banner bad" role="alert">
          {t.failing} bill{t.failing > 1 ? "s" : ""} in view no longer reconcile under the current checks.
          Open them to see which check fails.
        </div>
      )}

      {bills.length === 0 ? (
        <div className="card empty">
          <h2>No bills yet</h2>
          <p>
            Add a Keells e-bill or photograph a paper receipt. Each is checked line by line before it is
            saved.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <a className="btn primary" href={href.receipt}>
              Add photo receipt
            </a>
            <a className="btn" href={href.ebill}>
              Add Keells e-bill
            </a>
          </div>
        </div>
      ) : (
        <>
          <dl className="kpis" aria-label="Totals for the bills in view">
            <div className="kpi">
              <dt>Bills</dt>
              <dd>
                {t.bills}
                <span className="sub">{t.keellsBills} Keells</span>
              </dd>
            </div>
            <div className="kpi">
              <dt>Gross</dt>
              <dd>{rs(t.gross)}</dd>
            </div>
            <div className="kpi">
              <dt>Discount</dt>
              <dd>
                {rs(t.discount)}
                <span className="sub">{pct(t.discountRate)} of gross</span>
              </dd>
            </div>
            <div className="kpi">
              <dt>Net paid (captured)</dt>
              <dd>
                {rs(t.net)}
                <span className="sub">Keells {rs(t.keellsNet)} — a floor</span>
              </dd>
            </div>
          </dl>
          {t.keellsBills > 0 && <FloorCaveat compact />}

          <details
            className="filters-wrap"
            open={filtersOpen}
            onToggle={(e) => setFiltersOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Filters &amp; sort{filtered ? " (active)" : ""}</summary>
            <form role="search" className="filters" onSubmit={(e) => e.preventDefault()}>
              <div className="wide">
                <label className="field-label" htmlFor="f-text">
                  Search
                </label>
                <input
                  id="f-text"
                  type="search"
                  value={q.text}
                  placeholder="Reference, store or item"
                  onChange={(e) => set({ text: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="f-src">
                  Source
                </label>
                <select id="f-src" value={q.source} onChange={(e) => set({ source: e.target.value })}>
                  <option value="all">All</option>
                  {view.sources.map((s) => (
                    <option key={s} value={s}>
                      {s === "keells" ? "Keells e-bills" : s === "glomark" ? "Glomark receipts" : s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="f-month">
                  Month
                </label>
                <select id="f-month" value={q.month} onChange={(e) => set({ month: e.target.value })}>
                  <option value="all">All months</option>
                  {view.months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="f-sort">
                  Sort by
                </label>
                <select
                  id="f-sort"
                  value={`${q.sort}:${q.dir}`}
                  onChange={(e) => {
                    const [sort, dir] = e.target.value.split(":");
                    set({ sort: sort as SortKey, dir: dir as "asc" | "desc" });
                  }}
                >
                  {COLUMNS.flatMap((c) => [
                    <option key={`${c.key}d`} value={`${c.key}:desc`}>
                      {c.label.replace(" (Rs)", "")} (high → low)
                    </option>,
                    <option key={`${c.key}a`} value={`${c.key}:asc`}>
                      {c.label.replace(" (Rs)", "")} (low → high)
                    </option>,
                  ])}
                </select>
              </div>
              {filtered && (
                <button type="button" className="btn" onClick={() => setQ(defaultQuery)}>
                  Clear filters
                </button>
              )}
            </form>
          </details>

          <p className="muted small" role="status" aria-live="polite">
            {view.matching === bills.length
              ? `${bills.length} bills`
              : `${view.matching} of ${bills.length} bills match`}
            {view.rows.length < view.matching && ` · showing ${view.rows.length}`}
          </p>

          {view.matching === 0 ? (
            <div className="card empty">
              <h2>No bills match</h2>
              <p>Try a different search, or clear the filters.</p>
              <button className="btn" onClick={() => setQ(defaultQuery)}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className="card scroll" style={{ padding: 0 }}>
              <table className="cards">
                <caption className="sr-only" style={{ position: "absolute", left: -9999 }}>
                  Bills
                </caption>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} scope="col" className={c.num ? "num" : ""} aria-sort={ariaSort(c.key)}>
                        <button onClick={() => toggleSort(c.key)}>
                          {c.label}
                          <span aria-hidden="true">
                            {q.sort === c.key ? (q.dir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th scope="col">Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map(({ bill: b, ok }) => (
                    <tr key={b.ref}>
                      <td data-label="Date">
                        {fmtDate(b.date)} <span className="muted small">{b.time}</span>
                      </td>
                      <td data-label="Ref">
                        <a href={href.bill(b.ref)}>{b.ref}</a>
                        {b.demo && (
                          <span className="badge neutral" style={{ marginLeft: 6 }}>
                            demo
                          </span>
                        )}
                      </td>
                      <td data-label="Store">{b.store}</td>
                      <td data-label="Lines" className="num">
                        {b.items.length}
                      </td>
                      <td data-label="Gross" className="num">
                        {b.gross.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td data-label="Discount" className="num">
                        {b.discount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </td>
                      <td data-label="Net" className="num">
                        <strong>{b.net.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
                      </td>
                      <td data-label="Checks">
                        <StatusBadge ok={ok} okText="Pass" badText="Failed" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view.rows.length < view.matching && (
            <p>
              <button
                className="btn"
                onClick={() => setQ((p) => ({ ...p, limit: p.limit + defaultQuery.limit }))}
              >
                Show {Math.min(defaultQuery.limit, view.matching - view.rows.length)} more
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
}
