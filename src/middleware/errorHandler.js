// src/middleware/errorHandler.js
// Global error handling middleware

const { config } = require("../config");

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";

  // Log error details
  if (statusCode >= 500) {
    console.error(`[error] ${err.message}`, err.stack);
  } else {
    console.warn(`[warn] ${err.message}`);
  }

  const response = {
    error: {
      code,
      message: err.isOperational ? err.message : "An unexpected error occurred",
    },
  };

  // Include stack trace in development
  if (config.env === "development" && !err.isOperational) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

function notFoundHandler(_req, res) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Endpoint not found",
    },
  });
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  errorHandler,
  notFoundHandler,
};
