// tests/seed-plan.test.js
// Seeding plan: upsert-friendly, resumable, no re-embedding of unchanged rows.

const { descriptionHash, planSeed } = require("../src/scripts/seed-plan");

const CATALOG = [
  { title: "Inception", year: 2010, genre: "Sci-Fi", director: "Nolan", description: "dream heist" },
  { title: "Arrival", year: 2016, genre: "Sci-Fi", director: "Villeneuve", description: "linguist aliens" },
  { title: "Her", year: 2013, genre: "Romance", director: "Jonze", description: "ai love" },
];

function rowFor(movie) {
  return { title: movie.title, year: movie.year, description_hash: descriptionHash(movie.description) };
}

describe("planSeed", () => {
  it("plans everything on an empty database", () => {
    const { pending, unchanged } = planSeed([], CATALOG);

    expect(pending).toHaveLength(3);
    expect(unchanged).toBe(0);
    expect(pending[0].hash).toBe(descriptionHash(CATALOG[0].description));
  });

  it("skips rows whose description is unchanged (resumable rerun)", () => {
    // Simulates an interrupted run: two of three movies already ingested
    const { pending, unchanged } = planSeed([rowFor(CATALOG[0]), rowFor(CATALOG[1])], CATALOG);

    expect(unchanged).toBe(2);
    expect(pending.map((movie) => movie.title)).toEqual(["Her"]);
  });

  it("re-plans a movie whose description changed", () => {
    const stale = { ...rowFor(CATALOG[0]), description_hash: descriptionHash("old text") };
    const { pending, unchanged } = planSeed([stale, rowFor(CATALOG[1]), rowFor(CATALOG[2])], CATALOG);

    expect(unchanged).toBe(2);
    expect(pending.map((movie) => movie.title)).toEqual(["Inception"]);
  });

  it("does not confuse same-title movies from different years", () => {
    const remake = { ...CATALOG[0], year: 2030 };
    const { pending, unchanged } = planSeed([rowFor(CATALOG[0])], [CATALOG[0], remake]);

    expect(unchanged).toBe(1);
    expect(pending.map((movie) => movie.year)).toEqual([2030]);
  });

  it("leaves rows not in the catalog untouched (no delete planning)", () => {
    const extraneous = { title: "Not In Catalog", year: 1999, description_hash: "x" };
    const { pending, unchanged } = planSeed([extraneous], [CATALOG[0]]);

    expect(unchanged).toBe(0);
    expect(pending).toHaveLength(1); // only the catalog movie is planned; nothing is removed
  });
});
