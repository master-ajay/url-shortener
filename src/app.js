const express = require("express");
const routes = require("./routes/url.routes");
const app = express();

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', pid: process.pid }));

app.use("/", routes);

module.exports = app;
