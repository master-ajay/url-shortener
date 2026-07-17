const request = require("supertest");

jest.mock("../../config/db");
jest.mock("../../lib/cache", () => ({
  wrap: jest.fn((_key, _ttl, fn) => fn()),
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
}));

const app = require("../../app");
const db = require("../../config/db");

describe("GET /:code", () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  it("should redirect to the original url when code exists", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    db.query
      .mockResolvedValueOnce({
        rows: [{ original_url: "https://example.com", expires_at: future }],
      })
      .mockResolvedValueOnce({
        rows: [{ clicks: 1 }],
      });

    const response = await request(app).get("/abc123");

    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("https://example.com");
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("should return 404 when code does not exist", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get("/missingcode");

    expect(response.statusCode).toBe(404);
    expect(response.body.message).toBe("code not found");
  });

  it("should return 400 when code is too short", async () => {
    const response = await request(app).get("/ab");

    expect(response.statusCode).toBe(400);
    expect(db.query).toHaveBeenCalledTimes(0);
  });

  it("should return 400 when code is too long", async () => {
    const response = await request(app).get(
      "/aVeryLongCodeThatExceedsTwentyChars",
    );

    expect(response.statusCode).toBe(400);
    expect(db.query).toHaveBeenCalledTimes(0);
  });
});
