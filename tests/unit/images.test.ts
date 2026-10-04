import { describe, expect, it } from "vitest";
import { isRasterImage, RASTER_TYPES } from "../../src/domain/images";

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
});
