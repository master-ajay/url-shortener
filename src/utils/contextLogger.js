const requestContext = require("../config/asyncContext");
const logger = require("../lib/logger");

function getContextLogger() {
  const ctx = requestContext.getStore();
  if (ctx) {
    return logger.child({ reqId: ctx.reqId });
  } else {
    return logger;
  }
}

module.exports = getContextLogger;
