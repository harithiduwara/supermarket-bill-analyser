import type { CheckResult } from "../domain/types";

export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.id}>
          <span className={!c.applicable ? "muted" : c.ok ? "ok" : "bad"}>
            {!c.applicable ? "– n/a" : c.ok ? "✓ pass" : "✗ FAIL"}
          </span>{" "}
          <strong>{c.label}</strong>
          <div className="detail">{c.detail}</div>
        </li>
      ))}
    </ul>
  );
}
