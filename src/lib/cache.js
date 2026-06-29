const redisClient = require("../config/redis");

// Single-flight map: key → Promise (prevents cache stampede)
const inFlight = new Map();

async function get(key) {
  try {
    const val = await redisClient.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null; // Redis down → treat as miss
  }
}

async function set(key, value, ttlSeconds) {
  try {
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Redis down → non-fatal, DB result still returned to client
  }
}

async function del(key) {
  try {
    await redisClient.del(key);
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
