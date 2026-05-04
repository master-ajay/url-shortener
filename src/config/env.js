require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL,
  PG_CONNECTION_STRING : process.env.PG_CONNECTION_STRING
};
