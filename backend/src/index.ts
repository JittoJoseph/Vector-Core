import { createModuleLogger } from "./utils/logger.js";
import { getConfig } from "./utils/config.js";
import { connectDatabase } from "./db/client.js";
import { getMarketOrchestrator } from "./services/market-orchestrator.js";
import { getApiServer } from "./services/api-server.js";

const logger = createModuleLogger("main");

async function main(): Promise<void> {
  logger.info("═══════════════════════════════════════════");
  logger.info("  Vector Core — Explicit-Date Deadline Engine");
  logger.info("  Polymarket NO-side Simulation");
  logger.info("═══════════════════════════════════════════");

  // 1. Load and validate configuration
  const config = getConfig();
  logger.info(
    {
      deadlineLookaheadDays: config.strategy.deadlineLookaheadDays,
      minNoEntryPrice: config.strategy.minNoEntryPrice,
      maxNoEntryPrice: config.strategy.maxNoEntryPrice,
      maxSpread: config.strategy.maxSpread,
      minLiquidityNum: config.strategy.minLiquidityNum,
      startingCapital: config.portfolio.startingCapital,
      maxPositions: config.strategy.maxSimultaneousPositions,
    },
    "Configuration loaded",
  );

  // 2. Connect to database
  await connectDatabase();

  // 3. Start market orchestrator (event discovery + WS + execution)
  const orchestrator = getMarketOrchestrator();
  await orchestrator.start();

  // 4. Start API server
  const apiServer = getApiServer();
  await apiServer.start();

  logger.info("All systems operational ✓");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    try {
      apiServer.stop();
      orchestrator.stop();
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
    }

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "Unhandled rejection");
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
