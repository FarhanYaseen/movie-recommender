// src/config/index.js
// Centralized configuration management

require("dotenv").config();

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 3000,

  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || "movie_recommender",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  embedding: {
    apiKey: process.env.VOYAGE_API_KEY,
    model: "voyage-3",
    dimensions: 1024,
  },

  recommendations: {
    defaultLimit: 5,
    maxLimit: 50,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  },

  ask: {
    defaultLimit: 5,
    maxLimit: 10,
    maxQuestionLength: 500,
    maxTokens: 1024,
  },
};

function validateConfig() {
  const missing = [];

  if (!config.embedding.apiKey) {
    missing.push("VOYAGE_API_KEY");
  }
  if (!config.db.password && config.env === "production") {
    missing.push("DB_PASSWORD");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = { config, validateConfig };
