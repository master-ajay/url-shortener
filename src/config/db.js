const { Client } = require("pg");
const { PG_CONNECTION_STRING } = require("./env");

const connectionString = PG_CONNECTION_STRING

const client = new Client({
  connectionString,
});

module.exports = client;
