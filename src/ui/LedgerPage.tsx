import { useMemo, useState } from "react";
import { money, round, sum } from "../domain/num";
import { allPass, reconcile } from "../domain/reconcile";
import type { Bill } from "../domain/types";
import { CheckList } from "./CheckList";

export function LedgerPage({ bills }: { bills: Bill[] }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(
    () => bills.map((b) => ({ b, checks: reconcile(b) }))
      .filter(({ b }) => source === "all" || b.source === source)
      .filter(({ b }) => !q || (b.ref + b.store + b.items.map((i) => i.name).join(" ")).toLowerCase().includes(q.toLowerCase()))
      .sort((a, c) => (c.b.date + c.b.time).localeCompare(a.b.date + a.b.time)),
    [bills, q, source],
  );
  const keellsCount = bills.filter((b) => b.source === "keells").length;
  const net = round(sum(rows.map((r) => r.b.net)));

  return (
    <>
      <div className="caveat">
        <strong>These totals are a floor, not a measurement.</strong> Keells prints a running points balance, and where
        that chain breaks a trip happened that is not in this ledger — about 35% of Keells spend in the starting data.
        The Capture Gap view that quantifies it arrives in Phase 3; until then, read every Keells figure here as understated.
      </div>
      <div className="grid">
        <input placeholder="Search ref, store or item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option><option value="keells">Keells e-bills</option><option value="glomark">Glomark receipts</option>
        </select>
      </div>
      <p className="muted">{rows.length} of {bills.length} bills ({keellsCount} Keells) · net shown {money(net)} (captured only)</p>
      <div className="card scroll">
        <table>
          <thead><tr><th>Date</th><th>Ref</th><th>Store</th><th className="n">Lines</th><th className="n">Gross</th><th className="n">Discount</th><th className="n">Net</th><th>Checks</th></tr></thead>
          <tbody>
            {rows.map(({ b, checks }) => (
              <>
                <tr key={b.ref} onClick={() => setOpen(open === b.ref ? null : b.ref)} style={{ cursor: "pointer" }}>
                  <td>{b.date} {b.time}</td><td>{b.ref}</td><td>{b.store}</td>
                  <td className="n">{b.items.length}</td><td className="n">{money(b.gross)}</td><td className="n">{money(b.discount)}</td><td className="n">{money(b.net)}</td>
                  <td><span className={`badge ${allPass(checks) ? "ok" : "bad"}`}>{allPass(checks) ? "all pass" : "FAILED"}</span></td>
                </tr>
                {open === b.ref && (
                  <tr key={b.ref + "-d"}><td colSpan={8}>
                    <CheckList checks={checks} />
                    <div className="scroll"><table>
                      <thead><tr><th>#</th><th>Code</th><th>Item</th><th className="n">Price</th><th className="n">Qty</th><th className="n">Amount</th></tr></thead>
                      <tbody>{b.items.map((i, k) => (
                        <tr key={k}><td>{i.line ?? k + 1}</td><td>{i.code}</td><td>{i.name}</td><td className="n">{money(i.unitPrice)}</td><td className="n">{i.qty}</td><td className="n">{money(i.amount)}</td></tr>
                      ))}</tbody>
                    </table></div>
                    <div className="detail">Tenders: {b.tenders.map((t) => `${t.method} ${money(t.amount)}`).join(" + ")}</div>
                  </td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
