const request = require("supertest");

jest.mock("../../config/db");
jest.mock("../../config/redis");

const app = require("../../app");

describe("GET /health — Stage 0/1", () => {
  it("returns ok status and pid", async () => {
    const response = await request(app).get("/health");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      pid: process.pid,
    });
  });

  it("attaches X-Request-Id (Stage 2 correlation)", async () => {
    const response = await request(app).get("/health");

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["x-request-id"].length).toBeGreaterThan(0);
  });
});
