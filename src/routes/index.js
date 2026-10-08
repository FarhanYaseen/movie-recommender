// src/routes/index.js
// Route aggregator

const express = require("express");
const healthRoutes = require("./health");
const movieRoutes = require("./movies");
const docsRoutes = require("./docs");
const askRoutes = require("./ask");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/movies", movieRoutes);
router.use("/docs", docsRoutes);
router.use("/ask", askRoutes);

// Legacy alias for backwards compatibility: /recommend -> movies router's
// /recommend handler. The rewritten path must be relative to the movies
// router (it owns "/recommend", not "/movies/recommend").
router.get("/recommend", (req, res, next) => {
  req.url = "/recommend" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  movieRoutes(req, res, next);
});

module.exports = router;
