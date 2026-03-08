// src/routes/index.js
// Route aggregator

const express = require("express");
const healthRoutes = require("./health");
const movieRoutes = require("./movies");
const docsRoutes = require("./docs");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/movies", movieRoutes);
router.use("/docs", docsRoutes);

// Legacy endpoint for backwards compatibility
router.get("/recommend", (req, res, next) => {
  req.url = "/movies/recommend" + (req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "");
  movieRoutes(req, res, next);
});

module.exports = router;
