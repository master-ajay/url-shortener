const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const redisClient = require("../config/redis");

/**
 * S4-T1: Rate limit counters live in Redis so N Node processes share one budget.
 *
 * In-process state audit (what must NOT stay in RAM across instances):
 * - WAS: express-rate-limit MemoryStore (per-process counters) → now RedisStore
 * - OK: cache.js inFlight Map (per-process stampede coalescing only; TTL jitter is S4-T2)
 * - OK: requestId / ALS (per-request, not shared)
 *
 * Fail-open: if Redis is down, allow the request (passOnStoreError).
 * Availability over abuse-protection during outage — same spirit as cache fail-open.
 * Switch to fail-closed when abuse risk outweighs downtime.
 */
if (process.env.NODE_ENV === "test") {
  module.exports = (req, res, next) => next();
} else {
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
  const max = Number(process.env.RATE_LIMIT_MAX) || 100;

  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
    passOnStoreError: true,
    store: new RedisStore({
      prefix: "rl:",
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
  });

  module.exports = limiter;
}
