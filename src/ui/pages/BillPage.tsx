import { useEffect, useMemo, useState } from "react";
import { money } from "../../domain/num";
import { allPass, reconcile } from "../../domain/reconcile";
import type { AuditEvent } from "../../domain/types";
import { CheckList } from "../components/CheckList";
import { DemoBanner } from "../components/DemoBanner";
import { FloorCaveat } from "../components/FloorCaveat";
import { PageHeader } from "../components/PageHeader";
import { PhotoViewer } from "../components/PhotoViewer";
import { StatusBadge } from "../components/StatusBadge";
import { useApp } from "../context";
import { fmtDate, fmtDateTime } from "../format";
import { href } from "../router";

export function BillPage({ billRef }: { billRef: string }) {
  const { bills, store } = useApp();
  const bill = bills.find((b) => b.ref === billRef);
  const checks = useMemo(() => (bill ? reconcile(bill) : []), [bill]);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [imgs, ev] = await Promise.all([store.images(billRef), store.events(1000)]);
      if (live) {
        setPhotos(imgs);
        setEvents(ev.filter((e) => e.ref === billRef));
      }
    })();
    return () => {
      live = false;
    };
  }, [store, billRef]);

  if (!bill) {
    return (
      <>
        <PageHeader
          title="Bill not found"
          lead={`There is no bill with reference “${billRef}” in this ledger.`}
        />
        <a className="btn" href={href.ledger}>
          Back to the ledger
        </a>
      </>
    );
  }
  const n = (x: number) => money(x);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href={href.ledger}>Ledger</a> › {bill.ref}
      </nav>
      <PageHeader
        title={`${bill.store} · ${fmtDate(bill.date)}`}
        lead={
          <>
            Reference <code>{bill.ref}</code> · {bill.time} ·{" "}
            {bill.source === "keells" ? "Keells e-bill" : "photographed receipt"}
          </>
        }
        actions={<StatusBadge ok={allPass(checks)} />}
      />

      {bill.demo && <DemoBanner />}
      <section className="card" aria-labelledby="sum-h">
        <h2 id="sum-h">Summary (as printed)</h2>
        <dl className="facts">
          <div>
            <dt>Gross</dt>
            <dd>Rs {n(bill.gross)}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>Rs {n(bill.discount)}</dd>
          </div>
          <div>
            <dt>Net paid</dt>
            <dd>Rs {n(bill.net)}</dd>
          </div>
          <div>
            <dt>Points earned</dt>
            <dd>{bill.pointsEarned ?? "not printed"}</dd>
          </div>
          <div>
            <dt>Points balance printed</dt>
            <dd>{bill.pointsBalancePrinted ?? "not printed"}</dd>
          </div>
          {bill.loyaltyScheme && (
            <div>
              <dt>Loyalty scheme</dt>
              <dd>{bill.loyaltyScheme}</dd>
            </div>
          )}
          <div>
            <dt>Store code</dt>
            <dd>{bill.storeCode || "—"}</dd>
          </div>
        </dl>
        {bill.source === "keells" && (
          <div style={{ marginTop: 12 }}>
            <FloorCaveat compact />
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="chk-h">
        <h2 id="chk-h">Reconciliation</h2>
        <CheckList checks={checks} />
      </section>

      <section className="card scroll" aria-labelledby="items-h">
        <h2 id="items-h">Lines ({bill.items.length})</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Code</th>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Amount
              </th>
              {bill.items.some((i) => i.lineDiscount) && (
                <th scope="col" className="num">
                  Discount
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {bill.items.map((i, k) => (
              <tr key={k}>
                <td>{i.line ?? k + 1}</td>
                <td>{i.code}</td>
                <td>{i.name}</td>
                <td className="num">{n(i.unitPrice)}</td>
                <td className="num">{i.qty}</td>
                <td className="num">{n(i.amount)}</td>
                {bill.items.some((x) => x.lineDiscount) && (
                  <td className="num">{i.lineDiscount ? n(i.lineDiscount) : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid" style={{ alignItems: "start" }}>
        <section className="card scroll" aria-labelledby="pr-h">
          <h2 id="pr-h">Promotions</h2>
          {bill.promotions.length === 0 ? (
            <p className="muted">None on this bill.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Scheme</th>
                  <th scope="col">Applies to</th>
                  <th scope="col" className="num">
                    Rs
                  </th>
                </tr>
              </thead>
              <tbody>
                {bill.promotions.map((p, k) => (
                  <tr key={k}>
                    <td>{p.scheme ?? "(unlabelled)"}</td>
                    <td>
                      {p.code ? `line ${p.line} · ${p.code}${p.pct ? ` · ${p.pct}%` : ""}` : "whole bill"}
                    </td>
                    <td className="num">{n(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card scroll" aria-labelledby="tn-h">
          <h2 id="tn-h">Tenders</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col" className="num">
                  Rs
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.tenders.map((t, k) => (
                <tr key={k}>
                  <td>{t.method}</td>
                  <td className="num">{n(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {photos.length > 0 && <PhotoViewer files={photos} />}
      {bill.rawText && (
        <details className="card">
          <summary>
            <strong>Original e-bill text</strong>{" "}
            <span className="muted small">(the only record once the link expires)</span>
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: ".8rem" }}>
            {bill.rawText}
          </pre>
        </details>
      )}

      <section className="card scroll" aria-labelledby="ev-h">
        <h2 id="ev-h">History</h2>
        {events.length === 0 ? (
          <p className="muted">
            No individual events recorded (bills loaded as demo data are summarised on the Activity page).
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.at)}</td>
                  <td>{e.type}</td>
                  <td>{e.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
