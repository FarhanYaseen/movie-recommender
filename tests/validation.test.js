// tests/validation.test.js
// Request validation runs before any paid provider call, and the legacy
// /recommend alias matches the canonical route.

const request = require("supertest");

jest.mock("../src/config/database", () => ({
  pool: {},
  setupDatabase: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn(),
}));

jest.mock("../src/services/embedding", () => ({
  embedQuery: jest.fn(),
  embedDocument: jest.fn(),
  embedDocuments: jest.fn(),
}));

jest.mock("../src/services/movies", () => ({
  getAllMovies: jest.fn(),
  getMovieById: jest.fn(),
  findSimilarMovies: jest.fn(),
  createMovie: jest.fn(),
  deleteAllMovies: jest.fn(),
}));

const { createApp } = require("../src/app");
const movieService = require("../src/services/movies");
const embeddingService = require("../src/services/embedding");

const SAMPLE = [
  { id: 1, title: "Inception", genre: "Sci-Fi", year: 2010, director: "Nolan", similarity: "0.86" },
];

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
});

function expectNoProviderCalls() {
  expect(movieService.findSimilarMovies).not.toHaveBeenCalled();
  expect(embeddingService.embedQuery).not.toHaveBeenCalled();
}

describe("GET /api/v1/movies/recommend validation", () => {
  it.each([
    ["repeated q parameters", "/api/v1/movies/recommend?q=a&q=b"],
    ["object-style q parameter", "/api/v1/movies/recommend?q[a]=b"],
    ["missing q", "/api/v1/movies/recommend"],
    ["blank q", "/api/v1/movies/recommend?q=%20%20"],
  ])("rejects %s with 400 before any provider call", async (_name, url) => {
    const res = await request(app).get(url);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expectNoProviderCalls();
  });

  it("rejects q longer than 2000 characters", async () => {
    const res = await request(app).get(`/api/v1/movies/recommend?q=${"x".repeat(2001)}`);

    expect(res.status).toBe(400);
    expectNoProviderCalls();
  });

  it.each([["abc"], ["5abc"], ["0"], ["51"], ["-1"], ["2.5"]])(
    "rejects limit=%s with 400 before any provider call",
    async (limit) => {
      const res = await request(app).get(`/api/v1/movies/recommend?q=thriller&limit=${limit}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expectNoProviderCalls();
    }
  );

  it("accepts a valid query and omitted limit", async () => {
    movieService.findSimilarMovies.mockResolvedValue(SAMPLE);

    const res = await request(app).get("/api/v1/movies/recommend?q=thriller");

    expect(res.status).toBe(200);
    expect(movieService.findSimilarMovies).toHaveBeenCalledWith("thriller", undefined);
  });
});

describe("legacy /recommend alias", () => {
  it("returns the same response as the canonical route", async () => {
    movieService.findSimilarMovies.mockResolvedValue(SAMPLE);

    const canonical = await request(app).get("/api/v1/movies/recommend?q=thriller&limit=3");
    const legacy = await request(app).get("/recommend?q=thriller&limit=3");

    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(canonical.body);
  });

  it("applies the same validation", async () => {
    const res = await request(app).get("/recommend?q=a&q=b");

    expect(res.status).toBe(400);
    expectNoProviderCalls();
  });
});

describe("GET /api/v1/movies/:id validation", () => {
  it.each([["abc"], ["0"], ["-3"], ["1.5"]])("rejects id=%s with 400", async (id) => {
    const res = await request(app).get(`/api/v1/movies/${id}`);

    expect(res.status).toBe(400);
    expect(movieService.getMovieById).not.toHaveBeenCalled();
  });

  it("accepts a positive integer id", async () => {
    movieService.getMovieById.mockResolvedValue({ id: 7, title: "Arrival" });

    const res = await request(app).get("/api/v1/movies/7");

    expect(res.status).toBe(200);
    expect(movieService.getMovieById).toHaveBeenCalledWith(7);
  });
});
