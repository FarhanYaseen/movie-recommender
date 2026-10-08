"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { DocumentSummary, Job, UploadResponse } from "@/lib/types";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const POLL_INTERVAL_MS = 2000;

export default function DocumentsPage() {
  return (
    <RequireAuth>
      <Documents />
    </RequireAuth>
  );
}

function Documents() {
  const { token } = useAuth();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploadState, setUploadState] = useState<
    | { phase: "idle" }
    | { phase: "uploading" }
    | { phase: "duplicate" }
    | { phase: "ingesting"; job: Job | null }
    | { phase: "done" }
    | { phase: "failed"; message: string }
  >({ phase: "idle" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: DocumentSummary[] }>("/api/documents", { token });
      setDocuments(res.data);
      setListError(null);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Could not load documents.");
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(jobId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const job = await apiFetch<Job>(`/api/jobs/${jobId}`, { token });
        if (job.status === "completed") {
          stopPolling();
          setUploadState({ phase: "done" });
          refresh();
        } else if (job.status === "failed") {
          stopPolling();
          setUploadState({
            phase: "failed",
            message: job.error || "Ingestion failed. You can retry the upload.",
          });
          refresh();
        } else {
          setUploadState({ phase: "ingesting", job });
        }
      } catch (err) {
        stopPolling();
        setUploadState({
          phase: "failed",
          message: err instanceof ApiError ? err.message : "Lost contact with the ingestion job.",
        });
      }
    }, POLL_INTERVAL_MS);
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadState({ phase: "failed", message: "File is larger than 2 MiB." });
      return;
    }
    if (!/\.(txt|md)$/i.test(file.name)) {
      setUploadState({ phase: "failed", message: "Only .txt and .md files are supported." });
      return;
    }
    setUploadState({ phase: "uploading" });
    try {
      const form = new FormData();
      form.append("file", file);
      if (title.trim()) {
        form.append("title", title.trim());
      }
      const res = await apiFetch<UploadResponse>("/api/documents", {
        method: "POST",
        token,
        body: form,
      });
      if (res.status === "duplicate") {
        setUploadState({ phase: "duplicate" });
        refresh();
      } else {
        setUploadState({ phase: "ingesting", job: null });
        startPolling(res.job_id);
        refresh();
      }
      setFile(null);
      setTitle("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setUploadState({
        phase: "failed",
        message: err instanceof ApiError ? err.message : "Upload failed. Please try again.",
      });
    }
  }

  return (
    <div className="stack">
      <h1>Your documents</h1>

      <form onSubmit={onUpload} className="card stack" aria-label="Upload a document">
        <div>
          <label htmlFor="file">Text or Markdown file (max 2 MiB)</label>
          <input
            id="file"
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label htmlFor="title">Title (optional)</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defaults to the file name"
          />
        </div>
        <div>
          <button
            type="submit"
            className="primary"
            disabled={!file || uploadState.phase === "uploading" || uploadState.phase === "ingesting"}
          >
            {uploadState.phase === "uploading" ? "Uploading…" : "Upload"}
          </button>
        </div>

        <div aria-live="polite">
          {uploadState.phase === "ingesting" ? (
            <div className="stack">
              <span className="muted">
                Ingesting…{" "}
                {uploadState.job && uploadState.job.total_chunks
                  ? `${uploadState.job.completed_chunks}/${uploadState.job.total_chunks} chunks`
                  : "preparing"}
              </span>
              {uploadState.job && uploadState.job.total_chunks ? (
                <progress
                  value={uploadState.job.completed_chunks}
                  max={uploadState.job.total_chunks}
                />
              ) : (
                <progress />
              )}
            </div>
          ) : null}
          {uploadState.phase === "duplicate" ? (
            <p className="muted">This file was already ingested — showing the existing document.</p>
          ) : null}
          {uploadState.phase === "done" ? <p className="muted">Document ready.</p> : null}
          {uploadState.phase === "failed" ? (
            <p role="alert" className="error-text">
              {uploadState.message} You can fix the file and upload again — retrying does not
              create duplicate entries.
            </p>
          ) : null}
        </div>
      </form>

      {listError ? (
        <p role="alert" className="error-text">
          {listError}
        </p>
      ) : null}

      {documents === null && !listError ? <p className="muted">Loading documents…</p> : null}

      {documents && documents.length === 0 ? (
        <p className="muted">No documents yet. Upload a .txt or .md file to get started.</p>
      ) : null}

      {documents && documents.length > 0 ? (
        <ul className="doc-list">
          {documents.map((doc) => (
            <li key={doc.id} className="doc-row">
              <span className="title">{doc.title}</span>
              <span className={`badge ${doc.status}`}>{doc.status}</span>
              <span className="muted">
                {doc.chunk_count} chunk{doc.chunk_count === 1 ? "" : "s"}
              </span>
              <span className="muted">{doc.source_name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
