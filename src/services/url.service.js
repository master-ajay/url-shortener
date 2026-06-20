const db = require("../config/db");
const base62 = require("../utils/base62");
const  isValidUrl  = require("../utils/isValidUrl");

async function createShortUrl(url, retriedTimes = 0) {
  if (retriedTimes === 10) {
    throw new Error("Failed to insert after 10 retries");
  }

  const isUrlValid = isValidUrl(url);

  if (!isUrlValid) {
    throw new Error("Invalid URL");
  }

  const code = base62(Math.floor(Math.random() * 1000000000));

  try {
    await db.query(
      "INSERT INTO short_urls (short_code,original_url) VALUES ($1, $2)",
      [code, url],
    );
    return code;
  } catch (error) {
    if (error.code === "23505") {
      return createShortUrl(url, retriedTimes + 1);
    }
    throw error;
  }
}

async function getOriginalUrl(code) {
  const result = await db.query(
    "SELECT original_url FROM short_urls WHERE short_code = $1",
    [code],
  );

  return result.rows[0]?.original_url ?? null;
}

module.exports = { createShortUrl, getOriginalUrl };
