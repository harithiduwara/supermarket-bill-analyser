import { useEffect, useState } from "react";
import type { AuditEvent, AuditType } from "../../domain/types";
import { PageHeader } from "../components/PageHeader";
import { useApp } from "../context";
import { fmtDateTime } from "../format";
import { href } from "../router";

const LABEL: Record<AuditType, { text: string; cls: string }> = {
  added: { text: "✓ Added", cls: "ok" },
  duplicate: { text: "= Already present", cls: "neutral" },
  rejected: { text: "✕ Rejected", cls: "bad" },
  import: { text: "⇩ Import", cls: "neutral" },
  export: { text: "⇧ Export", cls: "neutral" },
  seed: { text: "● Starting data", cls: "neutral" },
};

export function ActivityPage() {
  const { store, bills } = useApp();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [type, setType] = useState<"all" | AuditType>("all");
  useEffect(() => {
    let live = true;
    void store.events(500).then((e) => live && setEvents(e));
    return () => {
      live = false;
    };
  }, [store, bills]);
  const shown = (events ?? []).filter((e) => type === "all" || e.type === type);
  const known = new Set(bills.map((b) => b.ref));

  return (
    <>
      <PageHeader
        title="Activity"
        lead="An append-only diary of what was added, rejected, imported and exported on this device. It is informational: the ledger is local, so this is not tamper-proof evidence."
      />
      <div style={{ maxWidth: 260, marginBottom: 12 }}>
        <label className="field-label" htmlFor="ev-type">
          Show
        </label>
        <select id="ev-type" value={type} onChange={(e) => setType(e.target.value as "all" | AuditType)}>
          <option value="all">All events</option>
          {Object.entries(LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v.text.replace(/^\S+ /, "")}
            </option>
          ))}
        </select>
      </div>
      {events === null ? (
        <p>Loading…</p>
      ) : shown.length === 0 ? (
        <div className="card empty">
          <h2>No events yet</h2>
          <p>Events appear here as you add, import or export bills.</p>
        </div>
      ) : (
        <div className="card scroll" style={{ padding: 0 }}>
          <table className="cards">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Reference</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">{fmtDateTime(e.at)}</td>
                  <td data-label="Event">
                    <span className={`badge ${LABEL[e.type].cls}`}>{LABEL[e.type].text}</span>
                  </td>
                  <td data-label="Reference">
                    {e.ref ? known.has(e.ref) ? <a href={href.bill(e.ref)}>{e.ref}</a> : e.ref : "—"}
                  </td>
                  <td data-label="Detail">
                    {e.detail ?? ""}
                    {e.via ? <span className="muted small"> · via {e.via}</span> : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
