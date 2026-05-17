const app = require("./app.js");
const { PORT } = require("./config/env");
const db = require("./config/db.js");

db.query("SELECT 1")
  .then(() => {
    console.log("Connected to url_shortener db");
  })
  .catch((error) => {
    console.log("DB connection failed", error);
    process.exit(1);
  });

const server = app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});

const gracefulshutdown = (signal) => {
  console.log(`[${process.pid}] ${signal} received`);
  server.close((err) => {
    if (err) {
      console.error("Error during server close:", err);
      process.exit(1);
    }

    db.end();
    console.log("All existing requests completed. Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 30000).unref();
};

process.on("SIGTERM", gracefulshutdown);
process.on("SIGINT", gracefulshutdown);
