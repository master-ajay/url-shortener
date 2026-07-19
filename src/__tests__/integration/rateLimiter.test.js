/**
 * Rate limiter is bypassed when NODE_ENV=test (see rateLimiter.js).
 * Redis-backed limiter is exercised with NODE_ENV=development.
 */
describe("rate limiter — Stage 4 (Redis store)", () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_MAX = process.env.RATE_LIMIT_MAX;
  const ORIGINAL_WINDOW = process.env.RATE_LIMIT_WINDOW_MS;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    if (ORIGINAL_MAX === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = ORIGINAL_MAX;
    if (ORIGINAL_WINDOW === undefined) delete process.env.RATE_LIMIT_WINDOW_MS;
    else process.env.RATE_LIMIT_WINDOW_MS = ORIGINAL_WINDOW;
    jest.resetModules();
  });

  it("bypasses limiting when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    jest.resetModules();

    jest.mock("../../config/db");
    jest.mock("../../config/redis");

    const request = require("supertest");
    const app = require("../../app");

    let lastResponse;
    for (let i = 0; i < 101; i++) {
      lastResponse = await request(app).get("/health");
    }

    expect(lastResponse.statusCode).toBe(200);
  });

  it("fail-opens (allows traffic) when Redis store errors", async () => {
    process.env.NODE_ENV = "development";
    process.env.RATE_LIMIT_MAX = "5";
    jest.resetModules();

    jest.doMock("../../config/db", () => ({ query: jest.fn() }));
    jest.doMock("../../config/redis", () => ({
      isReady: false,
      sendCommand: jest.fn().mockRejectedValue(new Error("redis down")),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      on: jest.fn(),
      connect: jest.fn(),
    }));

    let app;
    jest.isolateModules(() => {
      app = require("../../app");
    });

    const request = require("supertest");
    let lastResponse;
    for (let i = 0; i < 10; i++) {
      lastResponse = await request(app).get("/health");
    }

    expect(lastResponse.statusCode).toBe(200);
  });

  it("returns 429 after exceeding limit when Redis is available", async () => {
    process.env.NODE_ENV = "development";
    process.env.RATE_LIMIT_MAX = "5";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    jest.resetModules();

    jest.doMock("../../config/db", () => ({ query: jest.fn() }));

    const redisClient = require("../../config/redis");
    try {
      if (!redisClient.isOpen) await redisClient.connect();
      const keys = await redisClient.keys("rl:*");
      if (keys.length > 0) await redisClient.del(keys);
    } catch {
      return; // Redis unavailable — skip without failing CI
    }

    const request = require("supertest");
    const app = require("../../app");

    const responses = [];
    for (let i = 0; i < 6; i++) {
      responses.push(await request(app).get("/health"));
    }

    expect(responses.slice(0, 5).every((r) => r.statusCode === 200)).toBe(true);
    expect(responses[5].statusCode).toBe(429);
  }, 20000);
});
