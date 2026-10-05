/** Receipt photos must be raster images. SVG is refused: it is a document that can carry script, and the OCR
 * provider does not accept it either. These are exactly the formats the Anthropic vision API accepts. */
export const RASTER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const isRasterImage = (b: { type: string }): boolean =>
  (RASTER_TYPES as readonly string[]).includes(b.type.toLowerCase());

export const RASTER_MESSAGE = "Only JPEG, PNG, WebP or GIF photos can be added.";
