// src/routes/movies.js
// Movie endpoints

const express = require("express");
const movieService = require("../services/movies");
const { ValidationError, NotFoundError } = require("../middleware/errorHandler");

const router = express.Router();

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
    const { q: query, limit } = req.query;

    if (!query?.trim()) {
      throw new ValidationError("Query parameter 'q' is required");
    }

    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const results = await movieService.findSimilarMovies(query.trim(), parsedLimit);

    res.json({
      query: query.trim(),
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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      throw new ValidationError("Invalid movie ID");
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
