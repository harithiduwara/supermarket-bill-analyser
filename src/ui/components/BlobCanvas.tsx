import { useEffect, useRef, useState } from "react";

/** Draws a photo onto a <canvas> instead of pointing an <img> at a URL.
 *
 * There is no URL and no `src` to inject into: the browser decodes the Blob as a raster image
 * (createImageBitmap refuses anything that is not one, so a disguised document cannot render) and the
 * pixels are painted. It also downsizes large camera photos, so a 12-megapixel receipt is not held at full size. */
export function BlobCanvas({
  blob,
  label,
  maxSide,
  className,
}: {
  blob: Blob;
  /** accessible name — a canvas is otherwise invisible to a screen reader */
  label: string;
  /** longest side, in pixels, to draw at */
  maxSide: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void (async () => {
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = ref.current;
        if (!live || !canvas) {
          bitmap.close();
          return;
        }
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [blob, maxSide]);

  if (failed) {
    return label ? (
      <span role="img" aria-label={`${label} (could not be displayed)`} className="muted small">
        This photo could not be displayed.
      </span>
    ) : (
      <span aria-hidden="true" className="muted small">
        ✕
      </span>
    );
  }
  // An unnamed canvas is decorative (e.g. a thumbnail inside a button that already has a label): hide it from
  // assistive technology rather than expose an image with no name.
  return label ? (
    <canvas ref={ref} role="img" aria-label={label} className={className} />
  ) : (
    <canvas ref={ref} aria-hidden="true" className={className} />
  );
}
