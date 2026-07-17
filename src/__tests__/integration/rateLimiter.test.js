const request = require("supertest");

// Rate limiter is intentionally bypassed when NODE_ENV=test (see rateLimiter.js).
// This suite only asserts the bypass contract so CI does not expect 429 under Jest.
describe("rate limiter", () => {
  it("should bypass limiting in test env", async () => {
    expect(process.env.NODE_ENV).toBe("test");

    let lastResponse;
    for (let i = 0; i < 101; i++) {
      lastResponse = await request(require("../../app")).get("/health");
    }

    expect(lastResponse.statusCode).toBe(200);
  });
});
