const rateLimit = require("express-rate-limit");

// Skip rate limiter in test/stress-test mode
if (process.env.NODE_ENV === "test") {
  module.exports = (req, res, next) => next();
} else {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests, please try again later.",
  });

  module.exports = limiter;
}
