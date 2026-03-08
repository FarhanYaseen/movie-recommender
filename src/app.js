// src/app.js
// Express application setup

const express = require("express");
const path = require("path");
const routes = require("./routes");
const { requestLogger } = require("./middleware/requestLogger");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

function createApp() {
  const app = express();

  // Trust proxy for proper IP detection behind load balancer
  app.set("trust proxy", 1);

  // Disable x-powered-by header
  app.disable("x-powered-by");

  // Middleware
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // Serve static frontend
  app.use(express.static(path.join(__dirname, "../public")));

  // CORS headers (configure as needed for production)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // Routes
  app.use("/api/v1", routes);

  // Also mount at root for backwards compatibility
  app.use("/", routes);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
