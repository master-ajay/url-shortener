const { createClient } = require("redis");
const { REDIS_URL } = require("./env");

const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 500,
    reconnectStrategy: (retries) => {
      // Cap backoff; keep trying so recovery is automatic after outage
      return Math.min(retries * 100, 2000);
    },
  },
  // Reject commands while disconnected instead of queuing forever (hangs redirects)
  disableOfflineQueue: true,
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err.message);
});

module.exports = redisClient;
