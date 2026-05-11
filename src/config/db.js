const { Pool } = require("pg");
const { PG_CONNECTION_STRING } = require("./env");

const connectionString = PG_CONNECTION_STRING;

const pool = new Pool({
  connectionString,
});

module.exports = pool;


// TODO: update pool settings as per scale