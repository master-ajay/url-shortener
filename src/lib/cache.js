const redisClient = require("../config/redis");

// Single-flight map: key → Promise (prevents cache stampede)
const inFlight = new Map();

const REDIS_OP_TIMEOUT_MS = 200;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("redis op timeout")), ms);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

async function get(key) {
  try {
    if (!redisClient.isReady) return null;
    const val = await withTimeout(redisClient.get(key), REDIS_OP_TIMEOUT_MS);
    return val ? JSON.parse(val) : null;
  } catch {
    return null; // Redis down / slow → treat as miss
  }
}

async function set(key, value, ttlSeconds) {
  try {
    if (!redisClient.isReady) return;
    await withTimeout(
      redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds }),
      REDIS_OP_TIMEOUT_MS,
    );
  } catch {
    // Redis down → non-fatal, DB result still returned to client
  }
}

async function del(key) {
  try {
    if (!redisClient.isReady) return;
    await withTimeout(redisClient.del(key), REDIS_OP_TIMEOUT_MS);
  } catch {
    // Redis down → stale key will expire on its own via TTL
  }
}

async function wrap(key, ttlSeconds, fn) {
  const cached = await get(key);
  if (cached !== null) return cached;

  // Another request already fetching this key → wait on same Promise (single-flight)
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = fn()
    .then((value) => {
      if (value != null) set(key, value, ttlSeconds);
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

module.exports = { get, set, del, wrap };
