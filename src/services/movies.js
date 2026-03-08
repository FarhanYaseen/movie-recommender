// src/services/movies.js
// Movie business logic

const { pool } = require("../config/database");
const { embedQuery, embedDocument } = require("./embedding");
const { config } = require("../config");

async function getAllMovies() {
  const { rows } = await pool.query(
    "SELECT id, title, genre, year, director, description, created_at FROM movies ORDER BY id"
  );
  return rows;
}

async function getMovieById(id) {
  const { rows } = await pool.query(
    "SELECT id, title, genre, year, director, description, created_at FROM movies WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

async function findSimilarMovies(query, limit = config.recommendations.defaultLimit) {
  const safeLimit = Math.min(Math.max(limit, 1), config.recommendations.maxLimit);

  const queryVector = await embedQuery(query);

  const { rows } = await pool.query(
    `SELECT
       id, title, genre, year, director, description,
       1 - (embedding <=> $1::vector) AS similarity
     FROM movies
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryVector), safeLimit]
  );

  return rows.map((row) => ({
    ...row,
    similarity: Number(row.similarity).toFixed(4),
  }));
}

async function createMovie({ title, genre, year, director, description }) {
  const embedding = await embedDocument(description);

  const { rows } = await pool.query(
    `INSERT INTO movies (title, genre, year, director, description, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, genre, year, director, description, created_at`,
    [title, genre, year, director, description, JSON.stringify(embedding)]
  );

  return rows[0];
}

async function deleteAllMovies() {
  const { rowCount } = await pool.query("DELETE FROM movies");
  return rowCount;
}

module.exports = {
  getAllMovies,
  getMovieById,
  findSimilarMovies,
  createMovie,
  deleteAllMovies,
};
