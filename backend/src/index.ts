import { createModuleLogger } from "./utils/logger.js";
import { getConfig } from "./utils/config.js";
import { connectDatabase } from "./db/client.js";
import { getMarketOrchestrator } from "./services/market-orchestrator.js";
import { getApiServer } from "./services/api-server.js";

const logger = createModuleLogger("main");

async function main(): Promise<void> {
  const config = getConfig();
  logger.info(
    {
      stopLossDelta: config.strategy.stopLossDelta,
      gcpProject: config.google.project,
    },
    "Vector Core — WeatherNext fair-value simulation starting",
  );

  await connectDatabase();
  const apiServer = getApiServer();
  await apiServer.start();
  const orchestrator = getMarketOrchestrator();
  await orchestrator.start();

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    apiServer.stop();
    orchestrator.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (err) =>
    logger.error({ err }, "Unhandled rejection"),
  );
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
