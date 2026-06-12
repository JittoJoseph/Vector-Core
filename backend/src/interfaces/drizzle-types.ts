import type { InferSelectModel } from "drizzle-orm";
import type {
  simulatedTrades,
  distributionBuckets,
  distributionCampaigns,
  auditLogs,
  portfolio,
} from "../db/schema.js";

export type SimulatedTrade = InferSelectModel<typeof simulatedTrades>;
export type DistributionBucket = InferSelectModel<typeof distributionBuckets>;
export type DistributionCampaign = InferSelectModel<typeof distributionCampaigns>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type Portfolio = InferSelectModel<typeof portfolio>;
