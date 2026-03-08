// src/index.js
// Application entry point

const { config, validateConfig } = require("./config");
const { setupDatabase, shutdown } = require("./config/database");
const { createApp } = require("./app");

async function main() {
  try {
    // Validate configuration
    validateConfig();

    // Setup database
    await setupDatabase();

    // Create and start server
    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`[server] Running on http://localhost:${config.port} (${config.env})`);
      console.log("[server] Frontend: http://localhost:" + config.port);
      console.log("[server] API Docs: http://localhost:" + config.port + "/api/v1/docs");
    });

    // Graceful shutdown
    const signals = ["SIGTERM", "SIGINT"];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        console.log(`\n[server] Received ${signal}, shutting down...`);

        server.close(async () => {
          await shutdown();
          console.log("[server] Shutdown complete");
          process.exit(0);
        });

        // Force exit after 10 seconds
        setTimeout(() => {
          console.error("[server] Forced shutdown after timeout");
          process.exit(1);
        }, 10000);
      });
    });
  } catch (err) {
    console.error("[server] Failed to start:", err.message);
    process.exit(1);
  }
}

main();
