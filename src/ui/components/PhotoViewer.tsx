import { useEffect, useMemo, useState } from "react";

/** Shows the receipt photo(s) beside the editable table: verifying a transcription means looking at the original. */
export function PhotoViewer({ files }: { files: Blob[] }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(false);
  const current = Math.min(idx, urls.length - 1);
  if (!urls.length) return null;
  return (
    <section className="card viewer" aria-label="Receipt photo">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Photo {urls.length > 1 ? `${current + 1} of ${urls.length}` : ""}</h2>
        <button className="btn small" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>
          {zoom ? "Fit to width" : "Zoom in"}
        </button>
      </div>
      {/* A scrollable region must be keyboard-focusable so keyboard users can pan a zoomed photo (WCAG 2.1.1). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="frame" tabIndex={0} role="region" aria-label="Scrollable receipt image">
        <img className={zoom ? "zoom" : ""} src={urls[current]} alt={`Receipt, page ${current + 1}`} />
      </div>
      {urls.length > 1 && (
        <div className="thumbs">
          {urls.map((u, i) => (
            <div className="thumb" key={u}>
              <button
                className="pick"
                aria-pressed={i === current}
                aria-label={`Show photo ${i + 1}`}
                onClick={() => setIdx(i)}
              >
                <img src={u} alt="" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
