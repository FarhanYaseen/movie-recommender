// src/services/embedding.js
// Embedding service using Voyage AI API
//
// Pacing: all requests flow through a promise-chain queue, so concurrent
// callers serialize instead of racing a shared timestamp. The limiter is
// single-process — fine for this local demo, but it is not a distributed
// quota guarantee across multiple workers.

const { config } = require("../config");

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";

// Retryable: 429, 5xx, network failures. Never retried: auth (401/403) or
// other 4xx validation errors.
class EmbeddingError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function minIntervalMs() {
  return Math.ceil(60000 / config.embedding.requestsPerMinute);
}

// Promise-chain queue: each caller awaits the previous caller's slot, then
// waits out the remaining interval before firing.
let queueTail = Promise.resolve(0); // resolves to the timestamp of the last request

function schedule(task) {
  const run = queueTail.then(async (lastRequestAt) => {
    const waitMs = lastRequestAt + minIntervalMs() - Date.now();
    if (waitMs > 0) {
      console.log(`[embedding] Rate limit: waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    const startedAt = Date.now();
    return { startedAt, result: await task() };
  });
  // The chain must survive task failures, and the slot is consumed even on
  // failure (the request was still sent).
  queueTail = run.then(
    ({ startedAt }) => startedAt,
    () => Date.now()
  );
  return run.then(({ result }) => result);
}

function parseRetryAfterMs(header) {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 300) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 && ms <= 300000 ? ms : null;
  }
  return null;
}

function backoffMs(attempt) {
  const base = Math.min(1000 * 2 ** attempt, 30000);
  return base / 2 + Math.random() * (base / 2); // jitter in [base/2, base)
}

async function voyageRequest(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.embedding.timeoutMs);
  let response;
  try {
    response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.embedding.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err.name === "AbortError";
    throw new EmbeddingError(
      timedOut
        ? `Voyage API request timed out after ${config.embedding.timeoutMs}ms`
        : `Voyage API network error: ${err.message}`,
      { retryable: true }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    const error = new EmbeddingError(`Voyage API error (${response.status}): ${text}`, {
      status: response.status,
      retryable,
    });
    error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    throw error;
  }

  return response.json();
}

async function requestWithRetries(body) {
  const { maxRetries } = config.embedding;
  for (let attempt = 0; ; attempt++) {
    try {
      return await schedule(() => voyageRequest(body));
    } catch (err) {
      if (!(err instanceof EmbeddingError) || !err.retryable || attempt >= maxRetries) {
        throw err;
      }
      const delay = err.retryAfterMs ?? backoffMs(attempt);
      console.warn(
        `[embedding] Retryable failure (${err.status || "network"}), retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt + 1}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function validateEmbedding(embedding, index) {
  const { dimensions } = config.embedding;
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw new EmbeddingError(
      `Voyage API returned a malformed embedding at index ${index}: expected ${dimensions} dimensions, got ${Array.isArray(embedding) ? embedding.length : typeof embedding}`
    );
  }
  if (!embedding.every(Number.isFinite)) {
    throw new EmbeddingError(`Voyage API returned non-finite values in embedding at index ${index}`);
  }
  return embedding;
}

async function createEmbeddings(texts, inputType) {
  const data = await requestWithRetries({
    model: config.embedding.model,
    input: texts,
    input_type: inputType,
  });

  const items = data?.data;
  if (!Array.isArray(items) || items.length !== texts.length) {
    throw new EmbeddingError(
      `Voyage API returned ${Array.isArray(items) ? items.length : 0} embeddings for ${texts.length} inputs`
    );
  }

  // Map each embedding back to its input by the API's index field, so a
  // reordered response cannot mis-assign vectors.
  const byIndex = new Array(texts.length);
  for (const item of items) {
    if (!Number.isInteger(item?.index) || item.index < 0 || item.index >= texts.length) {
      throw new EmbeddingError("Voyage API returned an embedding with a missing or invalid index");
    }
    byIndex[item.index] = validateEmbedding(item.embedding, item.index);
  }
  if (byIndex.some((embedding) => embedding === undefined)) {
    throw new EmbeddingError("Voyage API response is missing embeddings for some inputs");
  }
  return byIndex;
}

async function embedDocument(text) {
  const [embedding] = await createEmbeddings([text], "document");
  return embedding;
}

// True batch embedding: one API request for many documents.
async function embedDocuments(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }
  return createEmbeddings(texts, "document");
}

async function embedQuery(text) {
  const [embedding] = await createEmbeddings([text], "query");
  return embedding;
}

module.exports = { embedDocument, embedDocuments, embedQuery, EmbeddingError };
