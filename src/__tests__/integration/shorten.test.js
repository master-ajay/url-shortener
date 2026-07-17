const request = require("supertest");

jest.mock("../../config/db");
jest.mock("../../config/redis");

const app = require("../../app");
const db = require("../../config/db");
const redis = require("../../config/redis");
const { shortenResponseSchema } = require("../../validators/url.validator");

describe("POST /shorten", () => {
  const insertedRow = {
    original_url: "https://www.example.com/very/long/url/path",
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  };
  const ORIGINAL_BASE_URL = process.env.BASE_URL;

  beforeEach(() => {
    db.query.mockReset();
    redis.get.mockReset().mockResolvedValue(null);
    redis.set.mockReset().mockResolvedValue("OK");
    redis.del.mockReset().mockResolvedValue(1);
    redis.isReady = true;
    process.env.BASE_URL = "http://localhost:3000";
  });

  afterAll(() => {
    process.env.BASE_URL = ORIGINAL_BASE_URL;
  });

  describe("Stage 0/1 — create + validation", () => {
    it("creates a short url and returns contract shape", async () => {
      db.query.mockResolvedValueOnce({ rows: [insertedRow] });

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://www.example.com/very/long/url/path" });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      expect(shortenResponseSchema.parse(response.body.data)).toEqual(
        response.body.data,
      );
      expect(response.body.data.short_url).toContain(response.body.data.code);
    });

    it("returns 400 when url is missing", async () => {
      const response = await request(app).post("/shorten").send({});

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it("returns 400 when url format is invalid", async () => {
      const response = await request(app)
        .post("/shorten")
        .send({ url: "not-a-url" });

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it("returns 400 when url scheme is not http/https", async () => {
      const response = await request(app)
        .post("/shorten")
        .send({ url: "ftp://example.com" });

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it("returns 500 when database insert fails", async () => {
      db.query.mockRejectedValueOnce(new Error("connection refused"));

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com" });

      expect(response.statusCode).toBe(500);
      expect(response.body.message).toBe("connection refused");
    });

    it("returns 500 before insert when BASE_URL is missing", async () => {
      delete process.env.BASE_URL;

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com" });

      expect(response.statusCode).toBe(500);
      expect(response.body.message).toBe("BASE_URL is not configured");
      expect(db.query).not.toHaveBeenCalled();
    });

    it("retries once on short-code collision", async () => {
      db.query
        .mockRejectedValueOnce({ code: "23505" })
        .mockResolvedValueOnce({ rows: [insertedRow] });

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com" });

      expect(response.statusCode).toBe(201);
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("gives up after 10 consecutive collisions", async () => {
      db.query.mockRejectedValue({ code: "23505" });

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com" });

      expect(response.statusCode).toBe(500);
      expect(response.body.message).toBe("Failed to insert after 10 retries");
      expect(db.query).toHaveBeenCalledTimes(10);
    });
  });

  describe("Stage 2 — custom codes", () => {
    it("creates url with custom_code", async () => {
      const row = {
        original_url: "https://example.com/custom",
        expires_at: insertedRow.expires_at,
      };
      db.query.mockResolvedValueOnce({ rows: [row] });

      const response = await request(app)
        .post("/shorten")
        .send({
          url: "https://example.com/custom",
          custom_code: "mycustom",
        });

      expect(response.statusCode).toBe(201);
      expect(response.body.data.code).toBe("mycustom");
      expect(response.body.data.short_url).toMatch(/\/mycustom$/);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO short_urls"),
        ["mycustom", "https://example.com/custom"],
      );
    });

    it("returns 409 when custom_code is already taken", async () => {
      db.query.mockRejectedValueOnce({ code: "23505" });

      const response = await request(app)
        .post("/shorten")
        .send({
          url: "https://example.com",
          custom_code: "taken123",
        });

      expect(response.statusCode).toBe(409);
      expect(response.body.message).toBe("Custom code already taken");
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("returns 400 when custom_code is too short", async () => {
      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com", custom_code: "ab" });

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it("returns 400 when custom_code is too long", async () => {
      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com", custom_code: "a".repeat(11) });

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it("returns 400 when custom_code has invalid characters", async () => {
      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://example.com", custom_code: "bad_code!" });

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe("Stage 3 — cache pre-warm", () => {
    it("pre-warms redis on create", async () => {
      db.query.mockResolvedValueOnce({ rows: [insertedRow] });

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://www.example.com/very/long/url/path" });

      expect(response.statusCode).toBe(201);
      expect(redis.set).toHaveBeenCalledWith(
        `url:${response.body.data.code}`,
        JSON.stringify(insertedRow),
        { EX: 300 },
      );
    });

    it("pre-warms redis for custom_code create", async () => {
      const row = {
        original_url: "https://example.com/custom",
        expires_at: insertedRow.expires_at,
      };
      db.query.mockResolvedValueOnce({ rows: [row] });

      await request(app)
        .post("/shorten")
        .send({
          url: "https://example.com/custom",
          custom_code: "warmcode",
        });

      expect(redis.set).toHaveBeenCalledWith(
        "url:warmcode",
        JSON.stringify(row),
        { EX: 300 },
      );
    });

    it("creates short url even when redis pre-warm fails", async () => {
      db.query.mockResolvedValueOnce({ rows: [insertedRow] });
      redis.set.mockRejectedValueOnce(new Error("redis set failed"));

      const response = await request(app)
        .post("/shorten")
        .send({ url: "https://www.example.com/very/long/url/path" });

      expect(response.statusCode).toBe(201);
      expect(response.body.success).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });
});
