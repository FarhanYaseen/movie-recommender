// src/routes/health.js
// Health check endpoints

const express = require("express");
const { healthCheck } = require("../config/database");

const router = express.Router();

router.get("/", async (_req, res) => {
  const checks = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {},
  };

  try {
    await healthCheck();
    checks.services.database = "connected";
  } catch {
    checks.status = "degraded";
    checks.services.database = "disconnected";
  }

  const statusCode = checks.status === "ok" ? 200 : 503;
  res.status(statusCode).json(checks);
});

router.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/ready", async (_req, res) => {
  try {
    await healthCheck();
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not ready" });
  }
});

module.exports = router;
