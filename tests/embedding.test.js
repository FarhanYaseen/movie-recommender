// tests/embedding.test.js
// Embedding service: limiter serialization, retry/backoff, batch mapping.
// Uses fake timers (which also fake Date.now) and a mocked global fetch.

function okResponse(items) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: items }),
  };
}

function errResponse(status, body = "err", retryAfter = null) {
  return {
    ok: false,
    status,
    text: async () => body,
    headers: { get: (name) => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
  };
}

function vector(dims, value = 0.5) {
  return new Array(dims).fill(value);
}

describe("embedding service", () => {
  let embedding;
  let config;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000); // far past the initial lastRequestAt of 0
    global.fetch = jest.fn();

    config = require("../src/config").config;
    config.embedding.apiKey = "test";
    config.embedding.dimensions = 3;
    config.embedding.requestsPerMinute = 60; // 1s interval keeps tests readable
    config.embedding.timeoutMs = 30000;
    config.embedding.maxRetries = 3;

    embedding = require("../src/services/embedding");
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  it("serializes concurrent callers through the rate limiter", async () => {
    global.fetch.mockResolvedValue(okResponse([{ index: 0, embedding: vector(3) }]));

    const first = embedding.embedQuery("a");
    const second = embedding.embedQuery("b");

    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // The second caller must wait out the full interval, not resume together
    await jest.advanceTimersByTimeAsync(999);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await expect(first).resolves.toEqual(vector(3));
    await expect(second).resolves.toEqual(vector(3));
  });

  it("retries a 429 and honors a valid Retry-After header", async () => {
    global.fetch
      .mockResolvedValueOnce(errResponse(429, "slow down", "7"))
      .mockResolvedValueOnce(okResponse([{ index: 0, embedding: vector(3) }]));

    const promise = embedding.embedQuery("a");
    const guard = promise.catch(() => {}); // avoid unhandled rejection noise if assertions throw

    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Before Retry-After elapses, no second attempt
    await jest.advanceTimersByTimeAsync(6999);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Retry-After (7s) then the limiter interval again
    await jest.advanceTimersByTimeAsync(1 + 1000);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toEqual(vector(3));
    await guard;
  });

  it("does not retry authentication errors", async () => {
    global.fetch.mockResolvedValue(errResponse(401, "bad key"));

    const promise = embedding.embedQuery("a");
    const assertion = expect(promise).rejects.toThrow("401");
    await jest.advanceTimersByTimeAsync(60000);
    await assertion;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries retryable failures", async () => {
    config.embedding.maxRetries = 2;
    global.fetch.mockResolvedValue(errResponse(500, "boom"));

    const promise = embedding.embedQuery("a");
    const assertion = expect(promise).rejects.toThrow("500");
    await jest.advanceTimersByTimeAsync(600000);
    await assertion;
    expect(global.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("maps batch embeddings back to inputs by index, even when reordered", async () => {
    global.fetch.mockResolvedValue(
      okResponse([
        { index: 1, embedding: vector(3, 0.2) },
        { index: 0, embedding: vector(3, 0.1) },
      ])
    );

    const promise = embedding.embedDocuments(["first", "second"]);
    await jest.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result[0]).toEqual(vector(3, 0.1));
    expect(result[1]).toEqual(vector(3, 0.2));
    // One API call for the whole batch
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.input).toEqual(["first", "second"]);
    expect(body.input_type).toBe("document");
  });

  it("rejects embeddings with wrong dimensions or non-finite values", async () => {
    global.fetch.mockResolvedValueOnce(okResponse([{ index: 0, embedding: vector(2) }]));
    let promise = embedding.embedQuery("a");
    let assertion = expect(promise).rejects.toThrow("expected 3 dimensions");
    await jest.advanceTimersByTimeAsync(0);
    await assertion;

    global.fetch.mockResolvedValueOnce(okResponse([{ index: 0, embedding: [0.1, NaN, 0.3] }]));
    promise = embedding.embedQuery("b");
    assertion = expect(promise).rejects.toThrow("non-finite");
    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it("rejects a batch response missing embeddings for some inputs", async () => {
    global.fetch.mockResolvedValue(okResponse([{ index: 0, embedding: vector(3) }]));

    const promise = embedding.embedDocuments(["a", "b"]);
    const assertion = expect(promise).rejects.toThrow("1 embeddings for 2 inputs");
    await jest.advanceTimersByTimeAsync(0);
    await assertion;
  });
});
