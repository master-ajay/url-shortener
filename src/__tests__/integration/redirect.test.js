const request = require("supertest");

jest.mock("../../config/db");
jest.mock("../../config/redis");

const app = require("../../app");
const db = require("../../config/db");
const redis = require("../../config/redis");

describe("GET /:code", () => {
  const future = () => new Date(Date.now() + 86400000).toISOString();
  const past = () => new Date(Date.now() - 86400000).toISOString();

  beforeEach(() => {
    db.query.mockReset();
    redis.get.mockReset().mockResolvedValue(null);
    redis.set.mockReset().mockResolvedValue("OK");
    redis.del.mockReset().mockResolvedValue(1);
    redis.isReady = true;
  });

  describe("Stage 0/1 — redirect + validation", () => {
    it("redirects to original url (301)", async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            { original_url: "https://example.com", expires_at: future() },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ clicks: 1 }] });

      const response = await request(app).get("/abc123");

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe("https://example.com");
    });

    it("returns 404 when code does not exist", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app).get("/missingcode");

      expect(response.statusCode).toBe(404);
      expect(response.body.message).toBe("code not found");
    });

    it("returns 400 when code is too short", async () => {
      const response = await request(app).get("/ab");

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    it("returns 400 when code is too long", async () => {
      const response = await request(app).get(
        "/aVeryLongCodeThatExceedsTwentyChars",
      );

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe("Stage 2 — clicks + expiry", () => {
    it("increments clicks on redirect", async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            { original_url: "https://example.com", expires_at: future() },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ clicks: 7 }] });

      const response = await request(app).get("/abc123");

      expect(response.statusCode).toBe(301);
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query.mock.calls[1][0]).toMatch(/UPDATE short_urls SET clicks/i);
      expect(db.query.mock.calls[1][1]).toEqual(["abc123"]);
    });

    it("returns 410 when url is expired", async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            original_url: "https://example.com/expired",
            expires_at: past(),
          },
        ],
      });

      const response = await request(app).get("/expired1");

      expect(response.statusCode).toBe(410);
      expect(response.body.message).toBe("URL has expired");
      expect(db.query.mock.calls.some(([sql]) => /UPDATE/i.test(sql))).toBe(
        false,
      );
    });

    it("returns 500 when click update fails", async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            { original_url: "https://example.com", expires_at: future() },
          ],
        })
        .mockRejectedValueOnce(new Error("update failed"));

      const response = await request(app).get("/abc123");

      expect(response.statusCode).toBe(500);
      expect(response.body.message).toBe("update failed");
    });
  });

  describe("Stage 3 — cache-aside", () => {
    it("serves redirect from redis without SELECT", async () => {
      redis.get.mockResolvedValueOnce(
        JSON.stringify({
          original_url: "https://cached.example",
          expires_at: future(),
        }),
      );
      db.query.mockResolvedValueOnce({ rows: [{ clicks: 5 }] });

      const response = await request(app).get("/cached1");

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe("https://cached.example");
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][0]).toMatch(/UPDATE short_urls SET clicks/i);
      expect(redis.get).toHaveBeenCalledWith("url:cached1");
    });

    it("populates redis after cache miss", async () => {
      redis.get.mockResolvedValueOnce(null);
      const row = {
        original_url: "https://example.com",
        expires_at: future(),
      };
      db.query
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [{ clicks: 1 }] });

      await request(app).get("/miss123");

      expect(redis.set).toHaveBeenCalledWith(
        "url:miss123",
        JSON.stringify(row),
        { EX: 300 },
      );
    });

    it("deletes cache entry on 410 expired", async () => {
      redis.get.mockResolvedValueOnce(
        JSON.stringify({
          original_url: "https://example.com/expired",
          expires_at: past(),
        }),
      );

      const response = await request(app).get("/expired1");

      expect(response.statusCode).toBe(410);
      expect(redis.del).toHaveBeenCalledWith("url:expired1");
      expect(db.query).not.toHaveBeenCalled();
    });

    it("still returns 410 when cache delete fails on expired url", async () => {
      redis.get.mockResolvedValueOnce(
        JSON.stringify({
          original_url: "https://example.com/expired",
          expires_at: past(),
        }),
      );
      redis.del.mockRejectedValueOnce(new Error("redis delete failed"));

      const response = await request(app).get("/expired1");

      expect(response.statusCode).toBe(410);
      expect(response.body.message).toBe("URL has expired");
      expect(db.query).not.toHaveBeenCalled();
    });

    it("falls back to DB when redis is down", async () => {
      redis.isReady = false;
      db.query
        .mockResolvedValueOnce({
          rows: [
            { original_url: "https://example.com", expires_at: future() },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ clicks: 1 }] });

      const response = await request(app).get("/abc123");

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe("https://example.com");
      expect(redis.get).not.toHaveBeenCalled();
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("still redirects when redis set fails after cache miss", async () => {
      redis.get.mockResolvedValueOnce(null);
      redis.set.mockRejectedValueOnce(new Error("redis set failed"));
      db.query
        .mockResolvedValueOnce({
          rows: [
            { original_url: "https://example.com", expires_at: future() },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ clicks: 1 }] });

      const response = await request(app).get("/abc123");

      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe("https://example.com");
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });
});
