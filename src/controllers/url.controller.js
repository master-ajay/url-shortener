const map = new Map();
const { BASE_URL } = require("../config/env");

function shorten(req, res, next) {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const code = Math.random().toString(36).slice(2, 8);

  map.set(code, url);
  res
    .status(201)
    .json({ code, short_url: `${BASE_URL}/${code}` });
}

function redirect(req, res, next) {
  const { code } = req.params;
  const url = map.get(code);

  if (!url) {
    return res.status(404).json({ error: "code not found" });
  }

  return res.redirect(301, url);
}

module.exports = { shorten, redirect };
