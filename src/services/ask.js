// src/services/ask.js
// Grounded answer generation (RAG) over pgvector retrieval, using Claude

const Anthropic = require("@anthropic-ai/sdk");
const { config } = require("../config");
const { AppError } = require("../middleware/errorHandler");
const movieService = require("./movies");

const SYSTEM_PROMPT = [
  "You are a movie recommendation expert.",
  "Answer ONLY from the movies listed in the CONTEXT section of the user's message.",
  "If the context cannot answer the question, say so plainly instead of inventing movies or details.",
  "Keep answers concise: 2-4 sentences per recommended movie.",
  "Refer to movies by their exact title as given in the context.",
].join(" ");

let client = null;

function getClient() {
  if (!config.anthropic.apiKey) {
    throw new AppError(
      "Answer generation is not configured (missing ANTHROPIC_API_KEY)",
      503,
      "NOT_CONFIGURED"
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

function isConfigured() {
  return Boolean(config.anthropic.apiKey);
}

function formatContext(movies) {
  const entries = movies.map((movie, i) => {
    const year = movie.year ? ` (${movie.year})` : "";
    return `${i + 1}. ${movie.title}${year} — similarity ${movie.similarity}\n   ${movie.description}`;
  });
  return entries.join("\n");
}

function buildMessages(question, movies) {
  return [
    {
      role: "user",
      content: `${question}\n\nCONTEXT:\n${formatContext(movies)}`,
    },
  ];
}

// Sources come from the retrieval result, not the model — citations are
// exact by construction.
function toSources(movies) {
  return movies.map((movie) => ({
    title: movie.title,
    similarity: movie.similarity,
  }));
}

function mapAnthropicError(err) {
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(
      "Answer generation is rate limited, try again shortly",
      429,
      "UPSTREAM_RATE_LIMITED"
    );
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new AppError("Answer generation is misconfigured", 503, "NOT_CONFIGURED");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AppError("Answer generation rejected the request", 502, "UPSTREAM_ERROR");
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError("Answer generation failed upstream", 502, "UPSTREAM_ERROR");
  }
  return err;
}

async function retrieveContext(question, limit) {
  const safeLimit = Math.min(Math.max(limit || config.ask.defaultLimit, 1), config.ask.maxLimit);
  return movieService.findSimilarMovies(question, safeLimit);
}

async function askQuestion(question, limit) {
  const anthropic = getClient();
  const movies = await retrieveContext(question, limit);

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.ask.maxTokens,
      system: SYSTEM_PROMPT,
      messages: buildMessages(question, movies),
    });

    const answer = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      question,
      answer,
      sources: toSources(movies),
      model: response.model,
    };
  } catch (err) {
    throw mapAnthropicError(err);
  }
}

module.exports = {
  SYSTEM_PROMPT,
  isConfigured,
  retrieveContext,
  askQuestion,
  toSources,
  mapAnthropicError,
};
