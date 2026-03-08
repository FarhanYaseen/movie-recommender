// src/routes/docs.js
// API documentation routes

const express = require("express");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const path = require("path");

const router = express.Router();

const swaggerDocument = YAML.load(path.join(__dirname, "../../docs/openapi.yaml"));

router.use("/", swaggerUi.serve);
router.get("/", swaggerUi.setup(swaggerDocument, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Movie Recommender API Docs",
}));

module.exports = router;
