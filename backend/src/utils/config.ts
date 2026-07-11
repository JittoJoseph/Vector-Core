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
      minNoEntryPrice: envNum("MIN_NO_ENTRY_PRICE", 0.75),
      maxNoEntryPrice: envNum("MAX_NO_ENTRY_PRICE", 0.9),

      maxSimultaneousPositions: envNum("MAX_SIMULTANEOUS_POSITIONS", 5),
      consecutiveLossPauseLimit: envNum("CONSECUTIVE_LOSS_PAUSE_LIMIT", 3),
      riskAutoResumeEnabled: envBool("RISK_AUTO_RESUME_ENABLED", false),
      riskAutoResumeCooldownMs: envNum("RISK_AUTO_RESUME_COOLDOWN_MS", 300_000),

      // Entry: genuine recovery + risk/reward.
      entryDipLookbackHours: envNum("ENTRY_DIP_LOOKBACK_HOURS", 48),
      entryConfirmHours: envNum("ENTRY_CONFIRM_HOURS", 6),
      entryReboundEpsilon: envNum("ENTRY_REBOUND_EPSILON", 0.03),
      entryMinRiskReward: envNum("ENTRY_MIN_RISK_REWARD", 1.1),

      // Risk anchor: R:R reference placed just below the recovery low.
      riskAnchorBuffer: envNum("RISK_ANCHOR_BUFFER", 0.03),
      // Exit stop: hold to resolution, cut only when NO falls to this floor.
      stopEnabled: envBool("STOP_ENABLED", true),
      stopFloor: envNum("STOP_FLOOR", 0.6),
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
