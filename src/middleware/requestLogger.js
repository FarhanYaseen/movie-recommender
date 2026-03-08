// src/middleware/requestLogger.js
// HTTP request logging middleware

const { config } = require("../config");

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const log = `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

    if (res.statusCode >= 400) {
      console.warn(log);
    } else if (config.env === "development") {
      console.log(log);
    }
  });

  next();
}

module.exports = { requestLogger };
