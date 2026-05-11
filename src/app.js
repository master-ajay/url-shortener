const express = require("express");
const routes = require("./routes/url.routes");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

// app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});

app.use(limiter);

app.use(express.json());

app.use(morgan("dev"));

app.get("/health", (req, res) => res.json({ status: "ok", pid: process.pid }));

app.use("/", routes);

module.exports = app;
