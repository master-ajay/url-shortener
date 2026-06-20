const request = require("supertest");
const app = require("../../app");

describe("rate limiter", () => {
  it("should return 429 after exceeding the request limit", async () => {
    let lastResponse;

    for (let i = 0; i < 101; i++) {
      lastResponse = await request(app).get("/health");
    }

    expect(lastResponse.statusCode).toBe(429);
  });
});
