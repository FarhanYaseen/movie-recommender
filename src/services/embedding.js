// src/services/embedding.js
// Embedding service using Voyage AI API

const { config } = require("../config");

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const RATE_LIMIT_DELAY_MS = 21000; // 21 seconds to stay under 3 RPM

let lastRequestTime = 0;

async function rateLimitedFetch(url, options) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS && lastRequestTime > 0) {
    const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastRequest;
    console.log(`[embedding] Rate limit: waiting ${Math.ceil(waitTime / 1000)}s...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();
  return fetch(url, options);
}

async function createEmbedding(text, inputType) {
  const response = await rateLimitedFetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.embedding.apiKey}`,
    },
    body: JSON.stringify({
      model: config.embedding.model,
      input: text,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function embedDocument(text) {
  return createEmbedding(text, "document");
}

async function embedQuery(text) {
  return createEmbedding(text, "query");
}

module.exports = { embedDocument, embedQuery };
