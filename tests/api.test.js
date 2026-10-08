// tests/api.test.js
// API tests with mocked providers — run without network, database, or API keys

const request = require("supertest");

const mockMessagesCreate = jest.fn();

jest.mock("../src/config/database", () => ({
  pool: {},
  setupDatabase: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn(),
}));

jest.mock("../src/services/movies", () => ({
  getAllMovies: jest.fn(),
  getMovieById: jest.fn(),
  findSimilarMovies: jest.fn(),
  createMovie: jest.fn(),
  deleteAllMovies: jest.fn(),
}));

jest.mock("@anthropic-ai/sdk", () => {
  const actual = jest.requireActual("@anthropic-ai/sdk");
  class MockAnthropic {
    constructor() {
      this.messages = { create: mockMessagesCreate, stream: jest.fn() };
    }
  }
  MockAnthropic.APIError = actual.APIError;
  MockAnthropic.RateLimitError = actual.RateLimitError;
  MockAnthropic.AuthenticationError = actual.AuthenticationError;
  MockAnthropic.BadRequestError = actual.BadRequestError;
  MockAnthropic.APIUserAbortError = actual.APIUserAbortError;
  return MockAnthropic;
});

const { createApp } = require("../src/app");
const { config } = require("../src/config");
const movieService = require("../src/services/movies");

const SAMPLE_MOVIES = [
  {
    id: 1,
    title: "Inception",
    genre: "Sci-Fi / Thriller",
    year: 2010,
    director: "Christopher Nolan",
    description: "A thief steals secrets through dream-sharing technology.",
    similarity: "0.8612",
  },
  {
    id: 2,
    title: "The Matrix",
    genre: "Sci-Fi / Action",
    year: 1999,
    director: "The Wachowskis",
    description: "A programmer discovers reality is a simulation.",
    similarity: "0.8104",
  },
];

let app;

beforeAll(() => {
  config.anthropic.apiKey = "test-key";
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  config.anthropic.apiKey = "test-key";
});

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.services.database).toBe("connected");
  });
});

describe("GET /api/v1/movies/recommend", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/api/v1/movies/recommend");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(movieService.findSimilarMovies).not.toHaveBeenCalled();
  });

  it("returns recommendations for a valid query", async () => {
    movieService.findSimilarMovies.mockResolvedValue(SAMPLE_MOVIES);

    const res = await request(app).get("/api/v1/movies/recommend?q=dream heist&limit=2");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      query: "dream heist",
      count: 2,
      data: SAMPLE_MOVIES,
    });
    expect(movieService.findSimilarMovies).toHaveBeenCalledWith("dream heist", 2);
  });
});

describe("POST /api/v1/ask", () => {
  it("returns 400 when question is missing", async () => {
    const res = await request(app).post("/api/v1/ask").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when question exceeds the length limit", async () => {
    const res = await request(app)
      .post("/api/v1/ask")
      .send({ question: "x".repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 503 when ANTHROPIC_API_KEY is not configured", async () => {
    config.anthropic.apiKey = "";

    const res = await request(app).post("/api/v1/ask").send({ question: "a space movie" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("NOT_CONFIGURED");
    expect(movieService.findSimilarMovies).not.toHaveBeenCalled();
  });

  it("returns a grounded answer with programmatic sources", async () => {
    movieService.findSimilarMovies.mockResolvedValue(SAMPLE_MOVIES);
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "Watch Inception — a dream heist thriller." }],
      model: "claude-opus-5-5",
    });

    const res = await request(app)
      .post("/api/v1/ask")
      .send({ question: "a dream heist movie" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      question: "a dream heist movie",
      answer: "Watch Inception — a dream heist thriller.",
      sources: [
        { title: "Inception", similarity: "0.8612" },
        { title: "The Matrix", similarity: "0.8104" },
      ],
      model: "claude-opus-5-5",
    });

    // The retrieved context is handed to the model, grounded in the system prompt
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.system).toMatch(/ONLY from the movies/i);
    expect(call.messages[0].content).toContain("CONTEXT:");
    expect(call.messages[0].content).toContain("Inception");
  });
});
