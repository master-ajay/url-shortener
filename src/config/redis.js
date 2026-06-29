const { createClient } = require("redis");
const { REDIS_URL } = require("./env");

const redisClient = createClient({
  url: REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

module.exports = redisClient;
