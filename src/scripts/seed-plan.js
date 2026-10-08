// src/scripts/seed-plan.js
// Pure planning logic for repeatable seeding: given the rows already in the
// database and the desired catalog, decide which movies need (re-)embedding.

const crypto = require("crypto");

function descriptionHash(description) {
  return crypto.createHash("sha256").update(description, "utf8").digest("hex");
}

function movieKey(title, year) {
  return `${title}\u0000${year}`;
}

// rows: [{ title, year, description_hash }] from the movies table.
// Unchanged rows (same description hash) are skipped, which makes an
// interrupted run resumable — rerunning skips everything already ingested.
function planSeed(rows, movies) {
  const existing = new Map(rows.map((row) => [movieKey(row.title, row.year), row.description_hash]));

  const pending = [];
  let unchanged = 0;
  for (const movie of movies) {
    const hash = descriptionHash(movie.description);
    if (existing.get(movieKey(movie.title, movie.year)) === hash) {
      unchanged++;
    } else {
      pending.push({ ...movie, hash });
    }
  }
  return { pending, unchanged };
}

module.exports = { descriptionHash, planSeed };
