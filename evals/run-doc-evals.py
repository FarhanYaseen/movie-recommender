#!/usr/bin/env python3
"""Live document-retrieval evaluation against the FastAPI backend.

Opt-in only: refuses to run unless RUN_LIVE_EVALS=true, because it exercises
the real Voyage embedding provider (paid / rate-limited quota).

Usage:
    RUN_LIVE_EVALS=true \
    EVAL_API_BASE=http://localhost:8000 \
    EVAL_EMAIL=alice@example.com EVAL_PASSWORD=alice-demo-password \
    python3 evals/run-doc-evals.py

Uploads the fixture documents (idempotent — re-uploads return "duplicate"),
waits for ingestion, runs the labeled queries from doc-golden-queries.json,
and reports document-level Recall@1, Recall@4, and MRR for in-scope queries,
plus the top similarity score for out-of-scope queries (for threshold
inspection). Writes a JSON report to docs/verification/.

Timing definition: per-query wall-clock time of the HTTP /api/search call as
measured by this client. It includes network, query embedding, and database
retrieval together; it is NOT a database-only latency figure.
"""

import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
FIXTURES = sorted((BASE_DIR / "fixtures" / "documents").glob("*.md"))
GOLDEN = json.loads((BASE_DIR / "doc-golden-queries.json").read_text())
REPORT_PATH = BASE_DIR.parent / "docs" / "verification" / "doc-retrieval-report.json"

API_BASE = os.environ.get("EVAL_API_BASE", "http://localhost:8000").rstrip("/")
EMAIL = os.environ.get("EVAL_EMAIL", os.environ.get("DEMO_USER_A_EMAIL", ""))
PASSWORD = os.environ.get("EVAL_PASSWORD", os.environ.get("DEMO_USER_A_PASSWORD", ""))


def request(method, path, token=None, json_body=None, multipart=None):
    url = f"{API_BASE}{path}"
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    if multipart is not None:
        boundary = uuid.uuid4().hex
        filename, content = multipart
        content_type = mimetypes.guess_type(filename)[0] or "text/plain"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="title"\r\n\r\n{filename}\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        data = body
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode())


def main():
    if os.environ.get("RUN_LIVE_EVALS") != "true":
        print("Refusing to run: set RUN_LIVE_EVALS=true to opt into live provider calls.")
        return 2
    if not EMAIL or not PASSWORD:
        print("Set EVAL_EMAIL and EVAL_PASSWORD (a seeded demo user).")
        return 2

    status, body = request("POST", "/api/auth/login", json_body={"email": EMAIL, "password": PASSWORD})
    if status != 200:
        print(f"Login failed ({status}): {body}")
        return 1
    token = body["access_token"]
    print(f"[doc-evals] Logged in as {EMAIL}")

    # Upload fixtures (idempotent) and wait for ingestion
    for path in FIXTURES:
        status, body = request("POST", "/api/documents", token=token, multipart=(path.name, path.read_bytes()))
        if status not in (200, 202):
            print(f"Upload failed for {path.name} ({status}): {body}")
            return 1
        job_id, doc_status = body.get("job_id"), body.get("status")
        print(f"[doc-evals] {path.name}: {doc_status}")
        if doc_status == "duplicate" or job_id is None:
            continue
        deadline = time.time() + 600
        while time.time() < deadline:
            status, job = request("GET", f"/api/jobs/{job_id}", token=token)
            if status != 200:
                print(f"Job poll failed ({status}): {job}")
                return 1
            if job["status"] == "completed":
                break
            if job["status"] == "failed":
                print(f"Ingestion failed for {path.name}: {job.get('error')}")
                return 1
            time.sleep(3)
        else:
            print(f"Timed out waiting for ingestion of {path.name}")
            return 1

    in_scope, out_scope = [], []
    for item in GOLDEN["queries"]:
        started = time.monotonic()
        status, body = request("POST", "/api/search", token=token, json_body={"query": item["query"], "limit": 8})
        elapsed_ms = (time.monotonic() - started) * 1000
        if status != 200:
            print(f"Search failed ({status}) for {item['query']!r}: {body}")
            return 1
        hits = body["data"]
        titles = [h["document_title"] for h in hits]
        top_score = hits[0]["score"] if hits else 0.0
        if item["in_scope"]:
            try:
                rank = titles.index(item["expected_document"]) + 1
            except ValueError:
                rank = None
            in_scope.append({"query": item["query"], "expected": item["expected_document"],
                             "rank": rank, "top_score": top_score, "elapsed_ms": round(elapsed_ms, 1)})
            marker = f"rank {rank}" if rank else "MISS"
            print(f"  [{marker:>7}] {item['query'][:60]}")
        else:
            out_scope.append({"query": item["query"], "top_score": top_score,
                              "elapsed_ms": round(elapsed_ms, 1)})
            print(f"  [oos {top_score:.3f}] {item['query'][:60]}")

    n = len(in_scope)
    recall1 = sum(1 for r in in_scope if r["rank"] == 1) / n
    recall4 = sum(1 for r in in_scope if r["rank"] and r["rank"] <= 4) / n
    mrr = sum(1 / r["rank"] for r in in_scope if r["rank"]) / n

    print(f"\n[doc-evals] Recall@1: {recall1:.2f}  Recall@4: {recall4:.2f}  MRR: {mrr:.3f}  ({n} in-scope queries)")
    if out_scope:
        print(f"[doc-evals] Out-of-scope top scores: "
              + ", ".join(f"{r['top_score']:.3f}" for r in out_scope))

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "api_base": API_BASE,
        "provenance": GOLDEN["provenance"],
        "embedding_model": os.environ.get("VOYAGE_MODEL", "voyage-3"),
        "sample_counts": {"in_scope": n, "out_of_scope": len(out_scope), "documents": len(FIXTURES)},
        "timing_definition": "client-measured wall-clock per /api/search HTTP call (network + embedding + retrieval combined)",
        "metrics": {"recall_at_1": round(recall1, 4), "recall_at_4": round(recall4, 4), "mrr": round(mrr, 4)},
        "in_scope_results": in_scope,
        "out_of_scope_results": out_scope,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(f"[doc-evals] Report written to {REPORT_PATH.relative_to(BASE_DIR.parent)}")
    return 0 if recall4 >= 0.8 else 1


if __name__ == "__main__":
    sys.exit(main())
