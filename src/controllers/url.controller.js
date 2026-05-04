const { BASE_URL } = require("../config/env");
const { createShortUrl, getOriginalUrl } = require("../services/url.service");

async function shorten(req, res, next) {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }
  try {
    const code = await createShortUrl(url);
    res.status(201).json({ code, short_url: `${BASE_URL}/${code}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "something went wrong" });
  }
}

async function redirect(req, res, next) {
  const { code } = req.params;
  const original_url = await getOriginalUrl(code);

  if (!original_url) {
    return res.status(404).json({ error: "code not found" });
  }

  return res.redirect(301, original_url);
}

module.exports = { shorten, redirect };
