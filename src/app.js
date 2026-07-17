const express = require("express");
const cors = require("cors");

const routes = require("./routes/url.routes");
const limiter = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorhandler");
const httpLogger = require("./middleware/httpLogger");
const requestId = require("./middleware/requestId");
const helmet = require("helmet");
const requestContext = require("./config/asyncContext");

const app = express();

// Trust proxy in production (if behind nginx/render/heroku/etc.)
// app.set("trust proxy", 1);

app.use(helmet());

// Request ID middleware
app.use(requestId);

app.use((req, res, next) => {
  requestContext.run({ reqId: req.id }, () => next());
});

// Logger middleware
app.use(httpLogger);

// Rate limiter
app.use(limiter);

// CORS
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }),
);

// Body parsers
app.use(express.json({ limit: "16kb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "16kb",
  }),
);

// Health route
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    pid: process.pid,
  });
});

// Routes
app.use("/", routes);

// Global error handler
app.use(errorHandler);

module.exports = app;
