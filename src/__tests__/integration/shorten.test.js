const request = require("supertest");
const app = require("../../app");

jest.mock("../../config/db");
const db = require("../../config/db");

describe("POST /shorten", () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  it("should create a short url", async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // simulated successful INSERT

    const response = await request(app)
      .post("/shorten")
      .send({
        url: "https://www.example.com/very/long/url/path",
      });

    expect(response.statusCode).toBe(201);
  });

  it("should return 400 when url missing", async () => {
    const response = await request(app).post("/shorten").send({});

    expect(response.statusCode).toBe(400);
    expect(db.query).toHaveBeenCalledTimes(0);
  });

  it("should return 400 when url invalid", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({ url: "not-a-url" });

    expect(response.statusCode).toBe(400);
    expect(db.query).toHaveBeenCalledTimes(0);
  });

  it("should return 500 when service fails", async () => {
    db.query.mockRejectedValueOnce(new Error("connection refused"));

    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com" });

    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe("connection refused");
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("should handle duplicate urls by retrying once", async () => {
    db.query
      .mockRejectedValueOnce({ code: "23505" })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com" });

    expect(response.statusCode).toBe(201);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("should return 400 when url scheme is not http/https", async () => {
    const response = await request(app)
      .post("/shorten")
      .send({ url: "ftp://example.com" });

    expect(response.statusCode).toBe(400);
    expect(db.query).toHaveBeenCalledTimes(0);
  });

  it("should give up after 10 consecutive collisions", async () => {
    db.query.mockRejectedValue({ code: "23505" });

    const response = await request(app)
      .post("/shorten")
      .send({ url: "https://example.com" });

    expect(response.statusCode).toBe(500);
    expect(response.body.message).toBe("Failed to insert after 10 retries");
    expect(db.query).toHaveBeenCalledTimes(10);
  });
});
