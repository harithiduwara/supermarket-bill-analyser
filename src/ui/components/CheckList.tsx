import type { CheckResult } from "../../domain/types";

export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ol className="checks" aria-label="Reconciliation checks">
      {checks.map((c) => (
        <li key={c.id}>
          <span className={!c.applicable ? "status-na" : c.ok ? "status-ok" : "status-bad"}>
            {!c.applicable ? "– n/a" : c.ok ? "✓ Pass" : "✕ FAIL"}
          </span>
          <strong>{c.label}</strong>
          <span className="detail">{c.detail}</span>
        </li>
      ))}
    </ol>
  );
}
