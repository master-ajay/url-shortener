jest.mock("../../config/redis");

const redisClient = require("../../config/redis");
const cache = require("../../lib/cache");

describe("cache — Stage 3", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.get.mockReset();
    redisClient.set.mockReset();
    redisClient.del.mockReset();
    redisClient.isReady = true;
  });

  describe("get", () => {
    it("returns parsed value on hit", async () => {
      redisClient.get.mockResolvedValueOnce(
        JSON.stringify({ original_url: "https://example.com" }),
      );

      const value = await cache.get("url:abc");

      expect(value).toEqual({ original_url: "https://example.com" });
      expect(redisClient.get).toHaveBeenCalledWith("url:abc");
    });

    it("returns null on miss", async () => {
      redisClient.get.mockResolvedValueOnce(null);

      await expect(cache.get("url:missing")).resolves.toBeNull();
    });

    it("returns null when redis is not ready (fail-open)", async () => {
      redisClient.isReady = false;

      await expect(cache.get("url:abc")).resolves.toBeNull();
      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it("returns null when redis throws (fail-open)", async () => {
      redisClient.get.mockRejectedValueOnce(new Error("connection refused"));

      await expect(cache.get("url:abc")).resolves.toBeNull();
    });

    it("returns null when redis is slow (op timeout)", async () => {
      redisClient.get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            const timer = setTimeout(
              () => resolve(JSON.stringify({ late: true })),
              1000,
            );
            if (typeof timer.unref === "function") timer.unref();
          }),
      );

      await expect(cache.get("url:slow")).resolves.toBeNull();
    }, 1500);
  });

  describe("set", () => {
    it("writes JSON with jittered TTL", async () => {
      redisClient.set.mockResolvedValueOnce("OK");
      const payload = { original_url: "https://example.com" };
      jest.spyOn(Math, "random").mockReturnValueOnce(0.5); // floor(0.5*60)=30 → TTL 330

      await cache.set("url:abc", payload, 300);

      expect(redisClient.set).toHaveBeenCalledWith(
        "url:abc",
        JSON.stringify(payload),
        { EX: 330 },
      );
      Math.random.mockRestore();
    });

    it("is a no-op when redis is not ready", async () => {
      redisClient.isReady = false;

      await cache.set("url:abc", { x: 1 }, 300);

      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it("swallows redis errors", async () => {
      redisClient.set.mockRejectedValueOnce(new Error("down"));

      await expect(
        cache.set("url:abc", { x: 1 }, 300),
      ).resolves.toBeUndefined();
    });
  });

  describe("TTL jitter — Stage 4", () => {
    it("withJitter returns base TTL when random is 0", () => {
      jest.spyOn(Math, "random").mockReturnValueOnce(0);
      expect(cache.withJitter(300)).toBe(300);
      Math.random.mockRestore();
    });

    it("withJitter adds up to jitter-1 seconds", () => {
      jest.spyOn(Math, "random").mockReturnValueOnce(0.999);
      expect(cache.withJitter(300)).toBe(300 + 59);
      Math.random.mockRestore();
    });

    it("withJitter leaves non-positive TTL unchanged", () => {
      expect(cache.withJitter(0)).toBe(0);
      expect(cache.withJitter(-1)).toBe(-1);
    });

    it("spread of many TTLs stays within [base, base+jitter)", () => {
      const samples = Array.from({ length: 200 }, () => cache.withJitter(300));
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(300);
      expect(Math.max(...samples)).toBeLessThan(300 + cache.TTL_JITTER_SECONDS);
      expect(new Set(samples).size).toBeGreaterThan(1);
    });
  });

  describe("del", () => {
    it("deletes the key", async () => {
      redisClient.del.mockResolvedValueOnce(1);

      await cache.del("url:abc");

      expect(redisClient.del).toHaveBeenCalledWith("url:abc");
    });

    it("swallows redis errors", async () => {
      redisClient.del.mockRejectedValueOnce(new Error("down"));

      await expect(cache.del("url:abc")).resolves.toBeUndefined();
    });
  });

  describe("wrap", () => {
    it("returns cached value without calling loader", async () => {
      const cached = { original_url: "https://cached.example" };
      redisClient.get.mockResolvedValueOnce(JSON.stringify(cached));
      const loader = jest.fn();

      const result = await cache.wrap("url:abc", 300, loader);

      expect(result).toEqual(cached);
      expect(loader).not.toHaveBeenCalled();
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it("calls loader on miss and populates cache", async () => {
      redisClient.get.mockResolvedValueOnce(null);
      redisClient.set.mockResolvedValueOnce("OK");
      const row = {
        original_url: "https://example.com",
        expires_at: "2099-01-01T00:00:00.000Z",
      };
      const loader = jest.fn().mockResolvedValueOnce(row);

      const result = await cache.wrap("url:abc", 300, loader);

      expect(result).toEqual(row);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(redisClient.set).toHaveBeenCalledWith(
        "url:abc",
        JSON.stringify(row),
        expect.objectContaining({
          EX: expect.any(Number),
        }),
      );
      const ttl = redisClient.set.mock.calls[0][2].EX;
      expect(ttl).toBeGreaterThanOrEqual(300);
      expect(ttl).toBeLessThan(300 + cache.TTL_JITTER_SECONDS);
    });

    it("does not cache null loader results", async () => {
      redisClient.get.mockResolvedValueOnce(null);
      const loader = jest.fn().mockResolvedValueOnce(null);

      const result = await cache.wrap("url:missing", 300, loader);

      expect(result).toBeNull();
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it("coalesces concurrent misses into a single loader call", async () => {
      // Defer redis GET so both wraps enter before either registers inFlight
      const releaseGets = [];
      redisClient.get.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseGets.push(() => resolve(null));
          }),
      );
      redisClient.set.mockResolvedValue("OK");

      const row = {
        original_url: "https://example.com",
        expires_at: "2099-01-01T00:00:00.000Z",
      };

      let resolveLoader;
      const loader = jest.fn(
        () =>
          new Promise((resolve) => {
            resolveLoader = resolve;
          }),
      );

      const first = cache.wrap("url:abc", 300, loader);
      const second = cache.wrap("url:abc", 300, loader);

      expect(releaseGets.length).toBe(2);

      // First GET completes → first wrap owns inFlight + calls loader
      releaseGets[0]();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(loader).toHaveBeenCalledTimes(1);

      // Second GET completes → should reuse inFlight, not call loader again
      releaseGets[1]();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(loader).toHaveBeenCalledTimes(1);

      resolveLoader(row);
      await expect(Promise.all([first, second])).resolves.toEqual([row, row]);
      expect(redisClient.set).toHaveBeenCalledTimes(1);
    });
  });
});
