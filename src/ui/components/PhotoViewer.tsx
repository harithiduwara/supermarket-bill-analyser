import { useState } from "react";
import { BlobCanvas } from "./BlobCanvas";

/** Shows the receipt photo(s) beside the editable table: verifying a transcription means looking at the original. */
export function PhotoViewer({ files }: { files: Blob[] }) {
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(false);
  const current = Math.min(idx, files.length - 1);
  if (!files.length) return null;
  return (
    <section className="card viewer" aria-label="Receipt photo">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Photo {files.length > 1 ? `${current + 1} of ${files.length}` : ""}</h2>
        <button className="btn small" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>
          {zoom ? "Fit to width" : "Zoom in"}
        </button>
      </div>
      {/* A scrollable region must be keyboard-focusable so keyboard users can pan a zoomed photo (WCAG 2.1.1). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="frame" tabIndex={0} role="region" aria-label="Scrollable receipt image">
        <BlobCanvas
          blob={files[current]}
          label={`Receipt, page ${current + 1}`}
          maxSide={2400}
          className={zoom ? "zoom" : ""}
        />
      </div>
      {files.length > 1 && (
        <div className="thumbs">
          {files.map((f, i) => (
            <div className="thumb" key={i}>
              <button
                className="pick"
                aria-pressed={i === current}
                aria-label={`Show photo ${i + 1}`}
                onClick={() => setIdx(i)}
              >
                <BlobCanvas blob={f} label="" maxSide={160} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
