const map = new Map();

function shorten(req, res, next) {
  const { url } = req.body;

  if (!url) {
    res.status(400).json({ error: "url is required" });
  }

  const code = Math.random().toString(36).slice(2, 8);

  map.set(code, url);
  res
    .status(201)
    .json({ code, short_url: `http://localhost:3000/redirect/${code}` });
}

function redirect(req, res, next) {
  const { code } = req.params;
  const url = map.get(code);

  res.status(201).json({ url: `http://localhost:3000/${url}` });
}

module.exports = { shorten, redirect };
