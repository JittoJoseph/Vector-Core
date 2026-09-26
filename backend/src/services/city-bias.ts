import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";

const DECAY = 0.98;
const PRIOR_WEIGHT = 8;
const DEFAULT_BIAS_C = 0.66;

export class CityBias {
  private rows = new Map<string, { weight: number; sum: number }>();

  async load(): Promise<void> {
    const rows = await getDb().select().from(schema.cityBias);
    this.rows = new Map(
      rows.map((r) => [r.city, { weight: r.weight, sum: r.sum }]),
    );
  }

  private global(): number {
    let weight = 0;
    let sum = 0;
    for (const r of this.rows.values()) {
      weight += r.weight;
      sum += r.sum;
    }
    return weight > 0 ? sum / weight : DEFAULT_BIAS_C;
  }

  get(city: string): number {
    const g = this.global();
    const r = this.rows.get(city);
    return r ? (r.sum + PRIOR_WEIGHT * g) / (r.weight + PRIOR_WEIGHT) : g;
  }

  async record(city: string, residualC: number): Promise<void> {
    const prev = this.rows.get(city) ?? { weight: 0, sum: 0 };
    const next = {
      weight: DECAY * prev.weight + 1,
      sum: DECAY * prev.sum + residualC,
    };
    this.rows.set(city, next);
    await getDb()
      .insert(schema.cityBias)
      .values({ city, ...next })
      .onConflictDoUpdate({ target: schema.cityBias.city, set: next });
  }
}
