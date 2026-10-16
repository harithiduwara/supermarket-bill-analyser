import { afterEach, describe, expect, it, vi } from "vitest";
import { blobToBase64, RECEIPT_TOOL, transcribeImage } from "../../src/domain/ocr";

const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const ok = (input: unknown) =>
  new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_receipt", input }] }), {
    status: 200,
  });

afterEach(() => vi.unstubAllGlobals());

describe("US-02 / NFR-05 the OCR request", () => {
  it("sends the key only to api.anthropic.com, forces the tool, and uses the configured model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ store: "Glomark", lines: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const d = await transcribeImage(png, { apiKey: "sk-ant-x", model: "model-from-settings" });
    expect(d.store).toBe("Glomark");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-ant-x");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("model-from-settings");
    expect(body.tool_choice).toEqual({ type: "tool", name: RECEIPT_TOOL.name });
    expect(body.system).toMatch(/Never calculate, correct, estimate or fill in/);
    expect(body.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/png" } });
    expect(JSON.stringify(body)).not.toContain("sk-ant-x"); // the key is a header, never in the payload
  });
  it("surfaces an HTTP failure with its status instead of inventing a result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid x-api-key", { status: 401 })));
    await expect(transcribeImage(png, { apiKey: "bad", model: "m" })).rejects.toThrow(
      /Anthropic API 401: invalid x-api-key/,
    );
  });
  it("fails when the model returns no transcription", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 }),
        ),
    );
    await expect(transcribeImage(png, { apiKey: "k", model: "m" })).rejects.toThrow(/no transcription/);
  });
  it("tolerates a response with no content array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(transcribeImage(png, { apiKey: "k", model: "m" })).rejects.toThrow(/no transcription/);
  });
  it("encodes large images without overflowing the call stack", async () => {
    const big = new Blob([new Uint8Array(300_000).fill(65)]);
    const b64 = await blobToBase64(big);
    expect(atob(b64).length).toBe(300_000);
  });
  it("the tool schema requires every field so the model must say null for what it cannot read", () => {
    const req = RECEIPT_TOOL.input_schema.required as readonly string[];
    for (const f of ["printed_gross", "printed_discount", "printed_net", "lines", "tenders"])
      expect(req).toContain(f);
  });
});
