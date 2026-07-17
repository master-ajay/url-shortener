/**
 * Rate limiter is bypassed when NODE_ENV=test (see rateLimiter.js).
 * This file isolates the real limiter under NODE_ENV=development.
 */
describe("rate limiter — Stage 1", () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
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

  it("returns 429 after exceeding 100 requests when enabled", async () => {
    process.env.NODE_ENV = "development";
    jest.resetModules();

    jest.doMock("../../config/db", () => ({ query: jest.fn() }));
    jest.doMock("../../config/redis", () => ({
      isReady: false,
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
    for (let i = 0; i < 101; i++) {
      lastResponse = await request(app).get("/health");
    }

    expect(lastResponse.statusCode).toBe(429);
  }, 15000);
});
