require("dotenv").config();

function getBaseUrl() {
  const baseUrl = process.env.BASE_URL;

  if (!baseUrl) {
    throw new Error("BASE_URL is not configured");
  }

  try {
    const parsed = new URL(baseUrl);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("BASE_URL must be a valid URL");
  }
}

module.exports = {
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL,
  getBaseUrl,
  PG_CONNECTION_STRING: process.env.PG_CONNECTION_STRING,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  NODE_ENV: process.env.NODE_ENV || "production",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
};
