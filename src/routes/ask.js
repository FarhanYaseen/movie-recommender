// src/routes/ask.js
// Grounded RAG endpoint: retrieval + Claude answer

const express = require("express");
const askService = require("../services/ask");
const { config } = require("../config");
const { ValidationError } = require("../middleware/errorHandler");

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

// POST /ask - { question, limit? }
router.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const question = validateQuestion(body.question);
    const limit = validateLimit(body.limit);

    const result = await askService.askQuestion(question, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
