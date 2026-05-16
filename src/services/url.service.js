const db = require("../config/db");

async function getCode() {
  for (let i = 0; i < 10; i++) {
    const code = Math.random().toString(36).slice(2, 8);

    return code;
  }

  throw new Error("Failed to generate unique code");
}

async function createShortUrl(url, retriedTimes = 0) {
  if (retriedTimes === 10) {
    throw new Error("Failed to insert after 10 retries");
  }

  const isUrlValid = isValidUrl(url);

  if (!isUrlValid) {
    throw new Error("Invalid URL");
  }

  const code = await getCode();

  try {
    await db.query(
      "INSERT INTO create_urls (short_code,original_url) VALUES ($1, $2)",
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
    "SELECT original_url FROM create_urls WHERE short_code = $1",
    [code],
  );

  return result.rows[0]?.original_url ?? null;
}

module.exports = { createShortUrl, getOriginalUrl };

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
