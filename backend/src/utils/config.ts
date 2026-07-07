import { Config, ConfigSchema } from "../types/index.js";
import dotenv from "dotenv";

dotenv.config();

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envNum(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable: ${key}`);
  }
  return parsed;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

export function loadConfig(): Config {
  const isTest = process.env.NODE_ENV === "test";
  const rawConfig = {
    db: {
      url: env(
        "SUPABASE_DATABASE_URL",
        isTest ? "postgres://test:test@localhost:5432/test" : undefined,
      ),
    },
    portfolio: {
      startingCapital: envNum("STARTING_CAPITAL", 100),
      allowNegativeBalance: envBool("ALLOW_NEGATIVE_BALANCE", true),
    },
    strategy: {
      scanIntervalMs: envNum("SCAN_INTERVAL_MS", 60_000),
      // Outer sanity bounds; the recovery gate, not this band, drives entry.
      minNoEntryPrice: envNum("MIN_NO_ENTRY_PRICE", 0.75),
      maxNoEntryPrice: envNum("MAX_NO_ENTRY_PRICE", 0.97),

      minExpectedNetProfit: envNum("MIN_EXPECTED_NET_PROFIT_USDC", 0.1),
      maxSimultaneousPositions: envNum("MAX_SIMULTANEOUS_POSITIONS", 5),
      consecutiveLossPauseLimit: envNum("CONSECUTIVE_LOSS_PAUSE_LIMIT", 3),
      riskAutoResumeEnabled: envBool("RISK_AUTO_RESUME_ENABLED", false),
      riskAutoResumeCooldownMs: envNum("RISK_AUTO_RESUME_COOLDOWN_MS", 300_000),
      stopLossEnabled: envBool("STOP_LOSS_ENABLED", true),
      // Stop sits this far below the recovery low, never under the floor.
      stopLossBufferBelowLow: envNum("STOP_LOSS_BUFFER_BELOW_LOW", 0.03),
      stopLossAbsoluteFloor: envNum("STOP_LOSS_ABSOLUTE_FLOOR", 0.6),

      entryMinCampaignAgeFraction: envNum("ENTRY_MIN_CAMPAIGN_AGE_FRACTION", 0.3),
      // Secondary sanity bounds (mass strictly below candidate; modal stability).
      entryMaxTailYesMass: envNum("ENTRY_MAX_TAIL_YES_MASS", 0.25),
      entryMinModalMargin: envNum("ENTRY_MIN_MODAL_MARGIN", 0.05),
      entryDipLookbackHours: envNum("ENTRY_DIP_LOOKBACK_HOURS", 24),
      // Recovery gate: at/above high-confidence a stable price is enough; below
      // it, entry must sit at least one rebound-epsilon above the recovery low.
      // The same epsilon defines what counts as a dip and as a recovery.
      entryHighConfidenceNoPrice: envNum("ENTRY_HIGH_CONFIDENCE_NO_PRICE", 0.9),
      entryReboundEpsilon: envNum("ENTRY_REBOUND_EPSILON", 0.03),
    },
    admin: {
      password: env("ADMIN_PASSWORD", isTest ? "test-admin" : undefined),
    },
    server: {
      port: envNum("PORT", 4000),
      host: env("HOST", "0.0.0.0"),
    },
    logging: {
      level: env("LOG_LEVEL", "info"),
    },
    notifications: {
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    },
    env: env("NODE_ENV", "development"),
  };

  return ConfigSchema.parse(rawConfig);
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) configInstance = loadConfig();
  return configInstance;
}
