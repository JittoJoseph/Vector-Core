import { gte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const DAY_MS = 86_400_000;
const CITY_WINDOW_MS = 14 * DAY_MS;
const GLOBAL_WINDOW_MS = 7 * DAY_MS;
const RETAIN_MS = 30 * DAY_MS;
const SHRINK = 3;
const PRIOR_C = 0.66;

interface Residual {
  campaignId: string;
  city: string;
  closedAt: number;
  residualC: number;
}

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

  get(city: string, now = Date.now()): number {
    let globalSum = 0;
    let globalCount = 0;
    let citySum = 0;
    let cityCount = 0;
    for (const r of this.residuals) {
      if (r.closedAt > now) continue;
      if (r.closedAt >= now - GLOBAL_WINDOW_MS) {
        globalSum += r.residualC;
        globalCount++;
      }
      if (r.city === city && r.closedAt >= now - CITY_WINDOW_MS) {
        citySum += r.residualC;
        cityCount++;
      }
    }
    const prior = globalCount > 0 ? globalSum / globalCount : PRIOR_C;
    return (citySum + SHRINK * prior) / (cityCount + SHRINK);
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
