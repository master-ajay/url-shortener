const logger = require("../lib/logger");

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;

  logger.error({
    success: false,
    message: err.message,
    status: err.status,
  });

  res.status(err.statusCode).json({
    success: false,
    message: err.message,
    status: err.status,
  });
};

module.exports = errorHandler;
