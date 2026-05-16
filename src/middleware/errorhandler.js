const logger = require("../lib/logger");

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  logger.error({
    success: false,
    message: err.message,
    statusCode,
  });

  res.status(statusCode).json({
    success: false,
    message: err.message,
    statusCode,
  });
};

module.exports = errorHandler;
