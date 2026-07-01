import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("execution-policy");

export type PolymarketStatus =
  | "UNKNOWN"
  | "UP"
  | "HASISSUES"
  | "UNDERMAINTENANCE";

let currentStatus: PolymarketStatus = "UP";
let timer: NodeJS.Timeout | null = null;

async function checkStatus() {
  try {
    const res = await fetch("https://status.polymarket.com/v3/summary.json");
    if (!res.ok) return;

    const newStatus = ((await res.json()) as any)?.page?.status;
    if (
      newStatus &&
      newStatus !== currentStatus &&
      ["UP", "HASISSUES", "UNDERMAINTENANCE"].includes(newStatus)
    ) {
      logger.info(
        { old: currentStatus, new: newStatus },
        "Polymarket status changed",
      );
      currentStatus = newStatus;
    }
  } catch (e) {
    logger.error({ err: e }, "Failed to fetch Polymarket status");
  }
}

export const executionPolicy = {
  start: () => {
    checkStatus();
    timer = setInterval(checkStatus, 60_000);
  },
  stop: () => {
    if (timer) clearInterval(timer);
  },
  getStatus: () => currentStatus,
  canOpenNewPositions: () => currentStatus === "UP",
  canExecuteStopLoss: () =>
    currentStatus === "UP" || currentStatus === "HASISSUES",
};
