// src/routes/ask.js
// Grounded RAG endpoint: retrieval + Claude answer, JSON or SSE

const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const askService = require("../services/ask");
const { config } = require("../config");
const { ValidationError, AppError } = require("../middleware/errorHandler");

const router = express.Router();

function validateQuestion(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ValidationError("Field 'question' is required");
  }
  const question = raw.trim();
  if (question.length > config.ask.maxQuestionLength) {
    throw new ValidationError(
      `Field 'question' must be at most ${config.ask.maxQuestionLength} characters`
    );
  }
  return question;
}

function validateLimit(raw) {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const limit = parseInt(raw, 10);
  if (isNaN(limit) || limit < 1 || limit > config.ask.maxLimit) {
    throw new ValidationError(
      `Field 'limit' must be an integer between 1 and ${config.ask.maxLimit}`
    );
  }
  return limit;
}

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleStream(req, res, question, limit) {
  if (!askService.isConfigured()) {
    throw new AppError(
      "Answer generation is not configured (missing ANTHROPIC_API_KEY)",
      503,
      "NOT_CONFIGURED"
    );
  }

  // Retrieval runs before headers are sent so retrieval errors still
  // surface as normal JSON errors
  const movies = await askService.retrieveContext(question, limit);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Sources are known before generation starts — send them up front
  sendSseEvent(res, "sources", askService.toSources(movies));

  const stream = askService.streamAnswer(question, movies);

  req.on("close", () => stream.abort());

  try {
    stream.on("text", (text) => {
      sendSseEvent(res, "delta", { text });
    });

    const finalMessage = await stream.finalMessage();
    sendSseEvent(res, "done", { model: finalMessage.model });
  } catch (err) {
    // Client disconnect aborts the stream; nothing left to write in that case
    if (!(err instanceof Anthropic.APIUserAbortError)) {
      const mapped = askService.mapAnthropicError(err);
      console.error(`[ask] stream error: ${mapped.message}`);
      sendSseEvent(res, "error", {
        message: mapped.isOperational ? mapped.message : "Answer generation failed",
      });
    }
  } finally {
    res.end();
  }
}

// POST /ask - { question, limit?, stream? }
router.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const question = validateQuestion(body.question);
    const limit = validateLimit(body.limit);

    if (body.stream === true) {
      await handleStream(req, res, question, limit);
      return;
    }

    const result = await askService.askQuestion(question, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /ask?q=...&limit=N&stream=true - browser-friendly SSE variant
router.get("/", async (req, res, next) => {
  try {
    const question = validateQuestion(req.query.q);
    const limit = validateLimit(req.query.limit);

    if (req.query.stream === "true") {
      await handleStream(req, res, question, limit);
      return;
    }

    const result = await askService.askQuestion(question, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
