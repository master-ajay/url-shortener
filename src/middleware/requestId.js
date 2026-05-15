const { v4: uuid } = require("uuid");

function requestIdMiddleware(req, res, next) {
  req.id = uuid();
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestIdMiddleware;
