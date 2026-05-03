const { BASE_URL } = require("../config/env");
const db = require("../config/db")

async function shorten(req, res, next) {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const code = Math.random().toString(36).slice(2, 8);

  await db.query(
    "INSERT INTO create_urls (short_code,original_url) VALUES ($1, $2)",
    [code, url],
  );
  res.status(201).json({ code, short_url: `${BASE_URL}/${code}` });
}

async function redirect(req, res, next) {
  const { code } = req.params;

  const result = await db.query(
    "SELECT original_url from create_urls where short_code = $1",
    [code],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "code not found" });
  }

  const { original_url } = result.rows[0];
  return res.redirect(301, original_url);
}

module.exports = { shorten, redirect };
 