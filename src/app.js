const express = require("express");
const routes = require("./routes/url.routes");
const morgan = require("morgan");
const limiter = require("./middleware/rateLimiter");

const app = express();

//TODO: update in production to use different
// app.set("trust proxy", 1);

app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));

app.use(limiter);

app.use(express.json({ limit: "16KB" }));
app.use(
  express.urlencoded({
    extended: true,
    limit: "16kb",
  }),
);

app.use(morgan("dev"));

app.get("/health", (req, res) => res.json({ status: "ok", pid: process.pid }));

app.use("/", routes);

module.exports = app;
