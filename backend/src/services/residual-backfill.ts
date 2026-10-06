import { createModuleLogger } from "../utils/logger.js";
import {
  STATIONS,
  bucketRange,
  eventSlug,
  isFahrenheit,
} from "../utils/weather-logic.js";
import { localDayMaxC, winnerTempC } from "../utils/forecast-model.js";
import { PolymarketClient, getPolymarketClient } from "./polymarket-client.js";
import type { WeatherNextFeed } from "./weathernext.js";
import type { CityBias } from "./city-bias.js";

const logger = createModuleLogger("residual-backfill");

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const BACKFILL_DAYS = 14;

export interface ReferenceRules {
  leadMs: number;
  windowMs: number;
  minRuns: number;
}

interface Pending {
  campaignId: string;
  city: string;
  marketDay: string;
  dayStart: number;
  closedAt: number;
  actualC: number;
}

export interface BackfillStatus {
  state: "idle" | "running" | "done" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  missing: number;
  recorded: number;
  skipped: Record<string, number>;
  error: string | null;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class ResidualBackfill {
  private client = getPolymarketClient();
  private status: BackfillStatus = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    missing: 0,
    recorded: 0,
    skipped: {},
    error: null,
  };

  constructor(
    private feed: WeatherNextFeed,
    private bias: CityBias,
    private rules: ReferenceRules,
  ) {}

  getStatus(): BackfillStatus {
    return { ...this.status, skipped: { ...this.status.skipped } };
  }

  async run(): Promise<void> {
    const now = Date.now();
    this.status = {
      state: "running",
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
      missing: 0,
      recorded: 0,
      skipped: {},
      error: null,
    };
    try {
      const pending = await this.collect(now);
      if (pending.length) await this.record(pending);
      this.status.state = "done";
      logger.info(
        {
          missing: this.status.missing,
          recorded: this.status.recorded,
          skipped: this.status.skipped,
        },
        "Residual backfill complete",
      );
    } catch (err) {
      this.status.state = "failed";
      this.status.error = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Residual backfill failed");
    } finally {
      this.status.finishedAt = new Date().toISOString();
    }
  }

  private skip(reason: string): void {
    this.status.skipped[reason] = (this.status.skipped[reason] ?? 0) + 1;
  }

  private async collect(now: number): Promise<Pending[]> {
    const days: string[] = [];
    for (let d = BACKFILL_DAYS + 1; d >= 0; d--)
      days.push(utcDay(now - d * DAY_MS));
    const pending: Pending[] = [];
    for (const city of Object.keys(STATIONS)) {
      for (const marketDay of days) {
        if (this.bias.has(city, marketDay)) continue;
        const event = await this.client.getEventBySlug(
          eventSlug(city, marketDay),
        );
        if (!event) {
          this.skip("no market listed");
          continue;
        }
        if (!event.closed || !event.closedTime) {
          this.skip("not closed yet");
          continue;
        }
        const closedAt = Date.parse(event.closedTime);
        if (closedAt < now - BACKFILL_DAYS * DAY_MS) {
          this.skip("outside the 14-day window");
          continue;
        }
        const gameStart = event.markets?.find(
          (m) => m.gameStartTime,
        )?.gameStartTime;
        const dayStart = gameStart
          ? Date.parse(gameStart.replace(" ", "T").replace(/\+00$/, "Z"))
          : NaN;
        if (!Number.isFinite(dayStart)) {
          this.skip("no local day start");
          continue;
        }
        const winner = (event.markets ?? []).find(
          (m) => (PolymarketClient.outcomePrices(m)?.[0] ?? 0) >= 0.99,
        );
        const actualC =
          winner?.groupItemTitle &&
          winnerTempC(
            bucketRange(winner.groupItemTitle),
            isFahrenheit(winner.groupItemTitle),
          );
        if (typeof actualC !== "number") {
          this.skip("winner is an open-ended bucket");
          continue;
        }
        this.status.missing++;
        pending.push({
          campaignId: String(event.id),
          city,
          marketDay,
          dayStart,
          closedAt,
          actualC,
        });
      }
    }
    return pending.sort((a, b) => a.dayStart - b.dayStart);
  }

  private async record(pending: Pending[]): Promise<void> {
    const refOf = (p: Pending) => p.dayStart - this.rules.leadMs;
    const from = refOf(pending[0]!) - this.rules.windowMs - 12 * HOUR_MS;
    const to = refOf(pending.at(-1)!);
    const runs = (await this.feed.listRuns(from, to)).sort(
      (a, b) => a.publishedAt - b.publishedAt,
    );
    const publishedAt = new Map(runs.map((r) => [r.init, r.publishedAt]));
    const cache = new Map<number, Map<string, number[]>>();
    const seriesOf = async (init: number) => {
      let series = cache.get(init);
      if (!series) {
        series = await this.feed.fetchSeries(init);
        cache.set(init, series);
      }
      return series;
    };

    for (const p of pending) {
      const ref = refOf(p);
      for (const init of [...cache.keys()])
        if (publishedAt.get(init)! < ref - this.rules.windowMs - DAY_MS)
          cache.delete(init);

      const eligible = runs.filter(
        (r) =>
          r.publishedAt <= ref &&
          r.publishedAt >= ref - this.rules.windowMs - DAY_MS,
      );
      const window: { publishedAt: number; fmaxC: number }[] = [];
      for (let k = eligible.length - 1; k >= 0; k--) {
        const run = eligible[k]!;
        const latest = window.at(-1);
        if (
          latest &&
          run.publishedAt < latest.publishedAt - this.rules.windowMs
        )
          break;
        const temps = (await seriesOf(run.init)).get(p.city);
        const fmaxC = temps ? localDayMaxC(temps, run.init, p.dayStart) : null;
        if (fmaxC !== null)
          window.unshift({ publishedAt: run.publishedAt, fmaxC });
      }
      if (window.length < this.rules.minRuns) {
        this.skip(
          `fewer than ${this.rules.minRuns} runs in the reference window`,
        );
        continue;
      }
      const refFmaxC =
        window.reduce((sum, c) => sum + c.fmaxC, 0) / window.length;
      await this.bias.record({
        campaignId: p.campaignId,
        city: p.city,
        marketDay: p.marketDay,
        closedAt: p.closedAt,
        residualC: p.actualC - refFmaxC,
      });
      this.status.recorded++;
    }
  }
}
