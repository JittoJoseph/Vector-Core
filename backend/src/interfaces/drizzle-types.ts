import type { InferSelectModel } from "drizzle-orm";
import type {
  simulatedTrades,
  deadlineMarkets,
  eventFamilies,
  auditLogs,
  portfolio,
} from "../db/schema.js";

export type SimulatedTrade = InferSelectModel<typeof simulatedTrades>;
export type Market = InferSelectModel<typeof deadlineMarkets>;
export type EventFamily = InferSelectModel<typeof eventFamilies>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type Portfolio = InferSelectModel<typeof portfolio>;
