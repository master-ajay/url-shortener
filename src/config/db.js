const { Client } = require("pg");

const connectionString = "postgresql://mac@localhost:5432/url_shortener";

const client = new Client({
  connectionString,
});

module.exports = client;
