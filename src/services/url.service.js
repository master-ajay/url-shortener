const db = require("../config/db");
const base62 = require("../utils/base62");
const isValidUrl = require("../utils/isValidUrl");
const ApiError = require("../utils/ApiError");
const getContextLogger = require("../utils/contextLogger");
const cache = require("../lib/cache");

const CACHE_TTL = 300; // 5 minutes

async function createShortUrl(url, custom_code = "", retriedTimes = 0) {
  const log = getContextLogger();
  log.info({ url: url.substring(0, 50) }, "Creating short URL");
  if (retriedTimes === 10) {
    throw new Error("Failed to insert after 10 retries");
  }

  const isUrlValid = isValidUrl(url);

  if (!isUrlValid) {
    throw new ApiError(400, "Invalid URL");
  }

  if (custom_code.length >= 3) {
    try {
      const inserted = await db.query(
        "INSERT INTO short_urls (short_code,original_url) VALUES ($1,$2) RETURNING original_url, expires_at",
        [custom_code, url],
      );
      await cache.set(`url:${custom_code}`, inserted.rows[0], CACHE_TTL);
      return custom_code
    } catch (err) {
      if (err.code === "23505") {
        throw new ApiError(409, "Custom code already taken");
      }
      throw err;
    }
  }

  const code = base62(Math.floor(Math.random() * 1000000000));

  try {
    const inserted = await db.query(
      "INSERT INTO short_urls (short_code,original_url) VALUES ($1, $2) RETURNING original_url, expires_at",
      [code, url],
    );
    await cache.set(`url:${code}`, inserted.rows[0], CACHE_TTL);
    return code;
  } catch (error) {
    if (error.code === "23505") {
      log.info(
        { retriedTimes: retriedTimes + 1 },
        "Short code collision, retrying",
      );
      return createShortUrl(url, "", retriedTimes + 1);
    }
    throw error;
  }
}

async function getOriginalUrl(code) {
  const log = getContextLogger();
  log.info({ code }, "Looking up original URL");

  const row = await cache.wrap(`url:${code}`, CACHE_TTL, async () => {
    const result = await db.query(
      "SELECT original_url, expires_at FROM short_urls WHERE short_code = $1",
      [code],
    );
    return result.rows[0] ?? null;
  });

  if (!row) {
    log.debug("URL not found");
    return null;
  }

  const isExpired = new Date(row.expires_at) < new Date();
  if (isExpired) {
    log.info({ code, expires_at: row.expires_at }, "URL has expired");
    await cache.del(`url:${code}`); // remove stale entry from cache
    throw new ApiError(410, "URL has expired");
  }

  const updateResult = await db.query(
    "UPDATE short_urls SET clicks = clicks + 1 WHERE short_code = $1 RETURNING clicks",
    [code],
  );
  log.info({ code, clicks: updateResult.rows[0].clicks }, "Incremented click counter");
  log.info("URL found");

  return row.original_url;
}

async function getUrlStats(code) {
  const log = getContextLogger();
  log.info({ code }, "Fetching URL stats");

  const result = await db.query(
    "SELECT short_code, original_url, clicks, created_at, expires_at FROM short_urls WHERE short_code = $1",
    [code],
  );

  const url = result.rows[0];

  if (url) {
    log.info(
      { code, clicks: url.clicks, expires_at: url.expires_at },
      "Stats found",
    );
    const isExpired = new Date(url.expires_at) < new Date();
    return { ...url, is_expired: isExpired };
  } else {
    log.debug("URL not found");
    return null;
  }
}

module.exports = { createShortUrl, getOriginalUrl, getUrlStats };
