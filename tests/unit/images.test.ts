import { describe, expect, it } from "vitest";
import { blobSrc, isRasterImage, RASTER_TYPES } from "../../src/domain/images";

describe("US-02 / threat model: only raster photos are accepted", () => {
  it("accepts the formats the vision API accepts, in any letter case", () => {
    for (const t of RASTER_TYPES) expect(isRasterImage({ type: t })).toBe(true);
    expect(isRasterImage({ type: "IMAGE/JPEG" })).toBe(true);
  });
  it("refuses SVG (a document that can carry script), other documents and unknown types", () => {
    for (const t of [
      "image/svg+xml",
      "text/html",
      "application/pdf",
      "image/heic",
      "application/octet-stream",
      "",
    ]) {
      expect(isRasterImage({ type: t }), t).toBe(false);
    }
  });
  it("only ever renders a blob: URL created by the page", () => {
    expect(blobSrc("blob:http://localhost:4173/5b2f")).toBe("blob:http://localhost:4173/5b2f");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "https://evil.example/x.png",
      "//evil.example",
      "",
    ]) {
      expect(blobSrc(bad), bad).toBeUndefined();
    }
  });
});
