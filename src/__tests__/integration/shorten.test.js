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

  it("should return 400 when url missing", async () => {});

  it("should return 400 when url invalid", async () => {});

  it("should return 500 when service fails", async () => {});

  it("should handle duplicate urls", async () => {});
});
