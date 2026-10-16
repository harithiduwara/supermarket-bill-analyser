import { describe, expect, it } from "vitest";
import { Settings, backupDue, memoryKV, oldestUnexportedChange } from "../../src/settings";

const mk = () => {
  const session = memoryKV();
  const local = memoryKV();
  return { session, local, s: new Settings(session, local, "env-model") };
};

describe("NFR-05 API key handling", () => {
  it("is held for the tab session only by default — never written to localStorage", () => {
    const { s, local } = mk();
    s.setApiKey("sk-ant-secret", false);
    expect(s.getApiKey()).toEqual({ key: "sk-ant-secret", remembered: false });
    expect(local.getItem("anthropic_api_key")).toBeNull();
  });
  it("persists only when the user opts in", () => {
    const { s, local, session } = mk();
    s.setApiKey("sk-ant-secret", true);
    expect(local.getItem("anthropic_api_key")).toBe("sk-ant-secret");
    session.removeItem("anthropic_api_key"); // new tab
    expect(s.getApiKey()).toEqual({ key: "sk-ant-secret", remembered: true });
  });
  it("opting back out removes the stored copy", () => {
    const { s, local } = mk();
    s.setApiKey("k", true);
    s.setApiKey("k", false);
    expect(local.getItem("anthropic_api_key")).toBeNull();
  });
  it("clear removes it everywhere", () => {
    const { s } = mk();
    s.setApiKey("k", true);
    s.clearApiKey();
    expect(s.getApiKey()).toEqual({ key: "", remembered: false });
  });
  it("an empty key clears", () => {
    const { s } = mk();
    s.setApiKey("k", true);
    s.setApiKey("   ", true);
    expect(s.getApiKey().key).toBe("");
  });
  it("survives storage that throws (private windows)", () => {
    const boom = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const s = new Settings(boom, boom);
    expect(() => s.setApiKey("k", true)).not.toThrow();
    expect(s.getApiKey().key).toBe("");
    expect(s.getModel()).toMatch(/^claude-/);
  });
});

describe("model setting", () => {
  it("prefers the saved value, then the build-time env, then the documented default", () => {
    const { s } = mk();
    expect(s.getModel()).toBe("env-model");
    s.setModel(" my-model ");
    expect(s.getModel()).toBe("my-model");
    expect(new Settings(memoryKV(), memoryKV()).getModel()).toBe("claude-sonnet-5-5");
  });
});

describe("US-06 backup reminder", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const ev = (type: string, at: string) => ({ type, at });

  it("is not due when nothing has changed — demo data never nags", () => {
    expect(backupDue(oldestUnexportedChange([ev("seed", "2026-01-01T00:00:00Z")], null), now)).toBe(false);
    expect(backupDue(null, now)).toBe(false);
  });
  it("is not due within 14 days of the first unexported change, due after", () => {
    expect(backupDue(new Date("2026-10-10T00:00:00Z"), now)).toBe(false);
    expect(backupDue(new Date("2026-10-01T00:00:00Z"), now)).toBe(true);
  });
  it("counts only added and imported bills as changes", () => {
    const events = [
      ev("duplicate", "2026-01-01T00:00:00Z"),
      ev("rejected", "2026-01-02T00:00:00Z"),
      ev("export", "2026-01-03T00:00:00Z"),
    ];
    expect(oldestUnexportedChange(events, null)).toBeNull();
    expect(
      oldestUnexportedChange([...events, ev("added", "2026-02-01T00:00:00Z")], null)?.toISOString(),
    ).toBe("2026-02-01T00:00:00.000Z");
  });
  it("an export covers earlier changes; only later ones count", () => {
    const events = [ev("added", "2026-09-01T00:00:00Z"), ev("added", "2026-10-02T00:00:00Z")];
    const last = new Date("2026-09-15T00:00:00Z");
    expect(oldestUnexportedChange(events, last)?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(oldestUnexportedChange(events, new Date("2026-10-03T00:00:00Z"))).toBeNull();
  });
  it("round-trips the last export time", () => {
    const { s } = mk();
    expect(s.getLastExport()).toBeNull();
    s.markExported(new Date("2026-10-04T10:00:00Z"));
    expect(s.getLastExport()?.toISOString()).toBe("2026-10-04T10:00:00.000Z");
  });
});
