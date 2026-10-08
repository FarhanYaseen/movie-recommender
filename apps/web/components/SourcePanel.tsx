"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ChunkDetail, Citation } from "@/lib/types";

// Citation chips; clicking one opens the cited source text in a dialog.
export function SourceCards({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<Citation | null>(null);

  if (citations.length === 0) {
    return null;
  }
  return (
    <>
      <div className="source-cards" aria-label="Sources">
        {citations.map((citation) => (
          <button
            key={citation.chunk_id}
            type="button"
            className="source-card"
            onClick={() => setOpen(citation)}
          >
            {citation.document_title} · §{citation.ordinal + 1}
          </button>
        ))}
      </div>
      {open ? <SourceDialog citation={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function SourceDialog({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const { token } = useAuth();
  const [chunk, setChunk] = useState<ChunkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ChunkDetail>(
      `/api/documents/${citation.document_id}/chunks/${citation.chunk_id}`,
      { token }
    )
      .then((detail) => {
        if (!cancelled) {
          setChunk(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load the source text.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [citation, token]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Source: ${citation.document_title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>
            {citation.document_title} · section {citation.ordinal + 1}
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close source view">
            Close
          </button>
        </header>
        <div className="body">
          {error ? (
            <p role="alert" className="error-text">
              {error}
            </p>
          ) : chunk ? (
            chunk.text
          ) : (
            <span className="muted">Loading source…</span>
          )}
        </div>
      </div>
    </div>
  );
}
