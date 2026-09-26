import { homedir } from "os";
import { join } from "path";
import dotenv from "dotenv";
import { Config, ConfigSchema } from "../types/index.js";

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

function defaultCredentialsPath(): string {
  return process.platform === "win32"
    ? join(
        process.env.APPDATA ?? "",
        "gcloud",
        "application_default_credentials.json",
      )
    : join(
        homedir(),
        ".config",
        "gcloud",
        "application_default_credentials.json",
      );
}

export function loadConfig(): Config {
  return ConfigSchema.parse({
    db: { url: env("SUPABASE_DATABASE_URL") },
    google: {
      credentialsPath: env(
        "GOOGLE_APPLICATION_CREDENTIALS",
        defaultCredentialsPath(),
      ),
      project: env("GCP_PROJECT", "weather-vector"),
    },
    portfolio: { startingCapital: envNum("STARTING_CAPITAL", 100) },
    strategy: { stopLossDelta: envNum("STOP_LOSS_DELTA", 0.2) },
    admin: { password: env("ADMIN_PASSWORD") },
    server: {
      port: envNum("PORT", 4000),
      host: env("HOST", "127.0.0.1"),
    },
    logging: { level: env("LOG_LEVEL", "info") },
    env: env("NODE_ENV", "development"),
  });
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) configInstance = loadConfig();
  return configInstance;
}
