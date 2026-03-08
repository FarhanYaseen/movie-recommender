// src/config/database.js
// Database connection pool and setup

const { Pool, Client } = require("pg");
const { config } = require("./index");

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool(config.db);

    pool.on("error", (err) => {
      console.error("[database] Unexpected error:", err.message);
    });

    pool.on("connect", () => {
      if (config.env === "development") {
        console.log("[database] New client connected");
      }
    });
  }
  return pool;
}

async function ensureDatabaseExists() {
  const { database, ...connectionConfig } = config.db;

  // Connect to default 'postgres' database to create our target database
  const client = new Client({
    ...connectionConfig,
    database: "postgres",
  });

  try {
    await client.connect();

    // Check if database exists
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    );

    if (result.rowCount === 0) {
      console.log(`[database] Creating database "${database}"...`);
      await client.query(`CREATE DATABASE "${database}"`);
      console.log(`[database] Database "${database}" created`);
    }
  } finally {
    await client.end();
  }
}

async function setupDatabase() {
  // First ensure the database exists
  await ensureDatabaseExists();

  // Now connect to our database and run migrations
  const client = await getPool().connect();
  try {
    console.log("[database] Running migrations...");

    // Enable pgvector extension
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (err) {
      if (err.message.includes("not available") || err.message.includes("could not open")) {
        throw new Error(
          "pgvector extension is not installed.\n\n" +
            "Install pgvector:\n" +
            "  macOS:   brew install pgvector\n" +
            "  Ubuntu:  sudo apt install postgresql-16-pgvector\n" +
            "  Docker:  use image pgvector/pgvector:pg16\n\n" +
            "Then restart PostgreSQL and try again."
        );
      }
      throw err;
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS movies (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        genre       TEXT,
        year        INT,
        director    TEXT,
        description TEXT NOT NULL,
        embedding   vector(${config.embedding.dimensions}),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS movies_embedding_hnsw_idx
      ON movies USING hnsw (embedding vector_cosine_ops)
    `);

    console.log("[database] Migrations complete");
  } finally {
    client.release();
  }
}

async function healthCheck() {
  const client = await getPool().connect();
  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}

async function shutdown() {
  console.log("[database] Closing pool...");
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  get pool() {
    return getPool();
  },
  setupDatabase,
  healthCheck,
  shutdown,
};
