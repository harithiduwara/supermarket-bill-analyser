import { useApp } from "../context";
import { removeDemo } from "../../domain/seed";

/** Shown wherever demo bills are in view: they are invented, and must never be mistaken for real spending. */
export function DemoBanner({ onRemoved }: { onRemoved?: () => Promise<void> }) {
  const { store, bills, refresh, toast } = useApp();
  const n = bills.filter((b) => b.demo).length;
  if (!n) return null;
  async function remove() {
    const removed = await removeDemo(store);
    await refresh();
    await onRemoved?.();
    toast(`Removed ${removed} demo bills.`);
  }
  return (
    <div className="banner info" role="note">
      <strong>Demo data.</strong> {n} of the bills here are invented, so you can try the app. They are never
      included in an export.{" "}
      <button className="btn small" onClick={remove}>
        Remove demo data
      </button>
    </div>
  );
}
