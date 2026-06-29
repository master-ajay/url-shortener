const app = require("./app.js");
const { PORT } = require("./config/env");
const db = require("./config/db.js");
const logger = require("./lib/logger");
const redisClient = require("./config/redis.js");

db.query("SELECT 1")
  .then(() => {
    console.log("Connected to url_shortener db");
  })
  .catch((error) => {
    console.log("DB connection failed", error);
    process.exit(1);
  });

redisClient
  .connect()
  .then(() => {
    logger.info("Redis connected successfully")
  })
  .catch((err) => {
    logger.error("Redis connection failed:", err);
  });

const server = app.listen(PORT, () => {
  logger.info(`Server started on ${PORT}`);
});

const gracefulshutdown = (signal) => {
  console.log(`[${process.pid}] ${signal} received`);
  server.close((err) => {
    if (err) {
      console.error("Error during server close:", err);
      process.exit(1);
    }

    db.end();
    console.log("All existing requests completed. Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 30000).unref();
};

process.on("SIGTERM", gracefulshutdown);
process.on("SIGINT", gracefulshutdown);
