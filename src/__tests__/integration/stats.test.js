const request = require("supertest");

jest.mock("../../config/db");
jest.mock("../../config/redis");

const app = require("../../app");
const db = require("../../config/db");
const redis = require("../../config/redis");

describe("GET /stats/:code — Stage 2", () => {
  beforeEach(() => {
    db.query.mockReset();
    redis.get.mockReset().mockResolvedValue(null);
    redis.set.mockReset().mockResolvedValue("OK");
    redis.isReady = true;
  });

  it("returns stats contract for an existing code", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const createdAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    db.query.mockResolvedValueOnce({
      rows: [
        {
          short_code: "abc123",
          original_url: "https://example.com",
          clicks: 42,
          created_at: createdAt,
          expires_at: future,
        },
      ],
    });

    const response = await request(app).get("/stats/abc123");

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      code: "abc123",
      original_url: "https://example.com",
      clicks: 42,
      created_at: createdAt,
      expires_at: future,
      is_expired: false,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("sets is_expired true when expires_at is past", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    db.query.mockResolvedValueOnce({
      rows: [
        {
          short_code: "oldcode",
          original_url: "https://example.com/old",
          clicks: 1,
          created_at: past,
          expires_at: past,
        },
      ],
    });

    const response = await request(app).get("/stats/oldcode");

    expect(response.statusCode).toBe(200);
    expect(response.body.data.is_expired).toBe(true);
  });

  it("returns 404 when code does not exist", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get("/stats/missing1");

    expect(response.statusCode).toBe(404);
    expect(response.body.message).toBe("URL not found");
  });

  it("returns 400 when code is too short", async () => {
    const response = await request(app).get("/stats/ab");

    expect(response.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns 400 when code is too long", async () => {
    const response = await request(app).get(
      "/stats/aVeryLongCodeThatExceedsTwentyChars",
    );

    expect(response.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("does not use redis for stats (always fresh clicks)", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    db.query.mockResolvedValueOnce({
      rows: [
        {
          short_code: "live123",
          original_url: "https://example.com",
          clicks: 9,
          created_at: future,
          expires_at: future,
        },
      ],
    });

    await request(app).get("/stats/live123");

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("returns 500 when stats query fails", async () => {
    db.query.mockRejectedValueOnce(new Error("stats query failed"));

    const response = await request(app).get("/stats/live123");

    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe("stats query failed");
  });
});
