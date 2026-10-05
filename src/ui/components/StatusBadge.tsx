/** Status is always icon + text, never colour alone (WCAG 1.4.1). */
export function StatusBadge({
  ok,
  okText = "All checks pass",
  badText = "Checks failed",
}: {
  ok: boolean;
  okText?: string;
  badText?: string;
}) {
  return <span className={`badge ${ok ? "ok" : "bad"}`}>{ok ? `✓ ${okText}` : `✕ ${badText}`}</span>;
}
