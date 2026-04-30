const app = require("./app.js");
const { PORT } = require("./config/env");

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

    console.log("All existing requests completed. Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 30000).unref();
};

process.on("SIGTERM", gracefulshutdown);
process.on("SIGINT", gracefulshutdown);
