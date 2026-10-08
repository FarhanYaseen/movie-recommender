// evals/run-evals.js
// Retrieval evaluation harness: runs golden queries against the live
// retrieval service and reports hit@k metrics.
//
// Run with: npm run evals
// Requires: seeded database, VOYAGE_API_KEY (each query is embedded live,
// so the free-tier rate limit makes a full run take a few minutes).
//
// Exits non-zero if hit@5 falls below the threshold (default 0.8,
// override with EVAL_HIT5_THRESHOLD) so it can gate CI.

const path = require("path");
const fs = require("fs");

const { validateConfig } = require("../src/config");
const { shutdown } = require("../src/config/database");
const { findSimilarMovies } = require("../src/services/movies");

const GOLDEN_QUERIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "golden-queries.json"), "utf8")
);

const HIT5_THRESHOLD = parseFloat(process.env.EVAL_HIT5_THRESHOLD || "0.8");

function hitAtK(resultTitles, expected, k) {
  const topK = resultTitles.slice(0, k);
  return expected.some((title) => topK.includes(title)) ? 1 : 0;
}

// The in-process rate limiter can't see requests made by other processes
// (e.g. a running dev server), so a 429 on the shared free-tier limit is
// still possible — back off and retry instead of failing the whole run
async function search(query, limit, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await findSimilarMovies(query, limit);
    } catch (err) {
      if (!err.message.includes("429") || attempt >= attempts) {
        throw err;
      }
      console.log(`[evals] Rate limited, retrying in 25s (attempt ${attempt}/${attempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 25000));
    }
  }
}

function pad(value, width) {
  return String(value).padEnd(width);
}

async function runEvals() {
  validateConfig();

  console.log(`[evals] Running ${GOLDEN_QUERIES.length} golden queries...\n`);

  const rows = [];

  for (const { query, expected } of GOLDEN_QUERIES) {
    const results = await search(query, 5);
    const titles = results.map((movie) => movie.title);

    rows.push({
      query,
      expected,
      hit1: hitAtK(titles, expected, 1),
      hit3: hitAtK(titles, expected, 3),
      hit5: hitAtK(titles, expected, 5),
      topTitle: titles[0] || "(none)",
      topSimilarity: results[0] ? parseFloat(results[0].similarity) : 0,
    });
  }

  const queryWidth = Math.max(...rows.map((row) => row.query.length)) + 2;

  console.log(
    `\n${pad("QUERY", queryWidth)}${pad("@1", 4)}${pad("@3", 4)}${pad("@5", 4)}${pad("TOP SIM", 9)}TOP HIT`
  );
  console.log("-".repeat(queryWidth + 17 + 20));

  for (const row of rows) {
    console.log(
      `${pad(row.query, queryWidth)}${pad(row.hit1 ? "✓" : "✗", 4)}${pad(row.hit3 ? "✓" : "✗", 4)}${pad(row.hit5 ? "✓" : "✗", 4)}${pad(row.topSimilarity.toFixed(4), 9)}${row.topTitle}`
    );
  }

  const count = rows.length;
  const mean = (key) => rows.reduce((sum, row) => sum + row[key], 0) / count;
  const hit1 = mean("hit1");
  const hit3 = mean("hit3");
  const hit5 = mean("hit5");
  const meanTopSim = mean("topSimilarity");

  console.log(
    `\n[evals] hit@1: ${hit1.toFixed(2)}  hit@3: ${hit3.toFixed(2)}  hit@5: ${hit5.toFixed(2)}  mean top similarity: ${meanTopSim.toFixed(4)}  (${count} queries)`
  );

  if (hit5 < HIT5_THRESHOLD) {
    console.error(`[evals] FAIL: hit@5 ${hit5.toFixed(2)} is below threshold ${HIT5_THRESHOLD}`);
    process.exitCode = 1;
  } else {
    console.log(`[evals] PASS: hit@5 ${hit5.toFixed(2)} >= threshold ${HIT5_THRESHOLD}`);
  }
}

runEvals()
  .catch((err) => {
    console.error("[evals] Failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => shutdown());
