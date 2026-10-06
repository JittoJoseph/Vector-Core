import { gte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const DAY_MS = 86_400_000;
const CITY_WINDOW_MS = 14 * DAY_MS;
const GLOBAL_WINDOW_MS = 7 * DAY_MS;
const RETAIN_MS = 30 * DAY_MS;
const SHRINK = 3;
export const CITY_MIN_RESIDUALS = 7;
export const GLOBAL_MIN_DAYS = 4;

interface Residual {
  campaignId: string;
  city: string;
  closedAt: number;
  residualC: number;
}

export interface GlobalCorrectionStatus {
  residuals: number;
  days: number;
  meanC: number | null;
  ready: boolean;
}

export type Correction =
  | { ready: true; biasC: number; residuals: number }
  | { ready: false; reason: string; residuals: number };

export class CityBias {
  private residuals: Residual[] = [];

  async load(): Promise<void> {
    const rows = await getDb()
      .select()
      .from(schema.forecastResiduals)
      .where(
        gte(
          schema.forecastResiduals.closedAt,
          new Date(Date.now() - RETAIN_MS),
        ),
      );
    this.residuals = rows.map((r) => ({
      campaignId: r.campaignId,
      city: r.city,
      closedAt: r.closedAt.getTime(),
      residualC: r.residualC,
    }));
  }

  global(now = Date.now()): GlobalCorrectionStatus {
    let sum = 0;
    let count = 0;
    const days = new Set<number>();
    for (const r of this.residuals) {
      if (r.closedAt > now || r.closedAt < now - GLOBAL_WINDOW_MS) continue;
      sum += r.residualC;
      count++;
      days.add(Math.floor(r.closedAt / DAY_MS));
    }
    return {
      residuals: count,
      days: days.size,
      meanC: count > 0 ? sum / count : null,
      ready: days.size >= GLOBAL_MIN_DAYS,
    };
  }

  correction(city: string, now = Date.now()): Correction {
    let sum = 0;
    let count = 0;
    for (const r of this.residuals) {
      if (r.city !== city || r.closedAt > now) continue;
      if (r.closedAt < now - CITY_WINDOW_MS) continue;
      sum += r.residualC;
      count++;
    }
    const global = this.global(now);
    if (!global.ready || global.meanC === null)
      return {
        ready: false,
        reason: `all-city error history covers ${global.days}/${GLOBAL_MIN_DAYS} required days`,
        residuals: count,
      };
    if (count < CITY_MIN_RESIDUALS)
      return {
        ready: false,
        reason: `${count}/${CITY_MIN_RESIDUALS} resolved markets in the last 14 days`,
        residuals: count,
      };
    return {
      ready: true,
      biasC: (sum + SHRINK * global.meanC) / (count + SHRINK),
      residuals: count,
    };
  }

  async record(residual: Residual): Promise<void> {
    if (this.residuals.some((r) => r.campaignId === residual.campaignId))
      return;
    const cutoff = Date.now() - RETAIN_MS;
    this.residuals = [
      ...this.residuals.filter((r) => r.closedAt >= cutoff),
      residual,
    ];
    await getDb()
      .insert(schema.forecastResiduals)
      .values({ ...residual, closedAt: new Date(residual.closedAt) })
      .onConflictDoNothing();
  }
}
