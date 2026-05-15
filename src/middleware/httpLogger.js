const pinoHttp = require("pino-http");
const logger = require("../lib/logger");

const httpLogger = pinoHttp({
  logger,
  genReqId: function (req) {
    return req.id;
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} completed`;
  },
  customErrorMessage(req, res) {
    return `${req.method} ${req.url} failed`;
  },

  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },

    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});

module.exports = httpLogger;
