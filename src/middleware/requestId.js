const { randomUUID } = require("crypto");

function requestIdMiddleware(req, res, next) {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestIdMiddleware;
