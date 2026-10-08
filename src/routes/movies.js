// src/routes/movies.js
// Movie endpoints

const express = require("express");
const movieService = require("../services/movies");
const { ValidationError, NotFoundError } = require("../middleware/errorHandler");

const router = express.Router();

const MAX_QUERY_LENGTH = 2000;
const MAX_LIMIT = 50;

// Validation happens before any paid embedding call. Express parses repeated
// query parameters (?q=a&q=b) into arrays, so the type check matters.
function validateQuery(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ValidationError("Query parameter 'q' must be a single non-empty string");
  }
  const query = raw.trim();
  if (query.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(`Query parameter 'q' must be at most ${MAX_QUERY_LENGTH} characters`);
  }
  return query;
}

function validateLimit(raw) {
  if (raw === undefined) {
    return undefined; // service applies the default (5)
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new ValidationError(`Query parameter 'limit' must be an integer between 1 and ${MAX_LIMIT}`);
  }
  const limit = parseInt(raw, 10);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`Query parameter 'limit' must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

// GET /movies - List all movies
router.get("/", async (_req, res, next) => {
  try {
    const movies = await movieService.getAllMovies();
    res.json({
      count: movies.length,
      data: movies,
    });
  } catch (err) {
    next(err);
  }
});

// GET /movies/recommend?q=...&limit=N - Get recommendations
// IMPORTANT: Must be before /:id route to avoid "recommend" being parsed as an ID
router.get("/recommend", async (req, res, next) => {
  try {
    const query = validateQuery(req.query.q);
    const limit = validateLimit(req.query.limit);

    const results = await movieService.findSimilarMovies(query, limit);

    res.json({
      query,
      count: results.length,
      data: results,
    });
  } catch (err) {
    next(err);
  }
});

// GET /movies/:id - Get movie by ID
router.get("/:id", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      throw new ValidationError("Movie ID must be a positive integer");
    }
    const id = parseInt(req.params.id, 10);
    if (id < 1) {
      throw new ValidationError("Movie ID must be a positive integer");
    }

    const movie = await movieService.getMovieById(id);
    if (!movie) {
      throw new NotFoundError("Movie not found");
    }

    res.json({ data: movie });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
