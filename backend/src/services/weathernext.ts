import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { getConfig } from "../utils/config.js";
import { createModuleLogger } from "../utils/logger.js";
import { STATIONS } from "../utils/weather-logic.js";

const logger = createModuleLogger("weathernext");

const EE_API = "https://earthengine.googleapis.com/v1";
const COLLECTION =
  "projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p05deg";
const BAND = "station_head_temperature_2m_mean";
const MAX_LEAD_HOURS = 60;
const READY_LEAD_HOURS = 48;
const POLL_MS = 5 * 60_000;
const SETTLE_MS = 60_000;
const LOOKBACK_MS = 10 * 3_600_000;

export interface ForecastRun {
  init: number;
  publishedAt: number;
  series: Map<string, number[]>;
}

interface Credentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

const call = (functionName: string, args: Record<string, unknown>) => ({
  functionInvocationValue: { functionName, arguments: args },
});
const constant = (value: unknown) => ({ constantValue: value });

function sampleExpression(init: string) {
  const collection = call("Collection.filter", {
    collection: call("Collection.filter", {
      collection: call("ImageCollection.load", { id: constant(COLLECTION) }),
      filter: call("Filter.equals", {
        leftField: constant("start_time"),
        rightValue: constant(init),
      }),
    }),
    filter: call("Filter.not", {
      filter: call("Filter.greaterThan", {
        leftField: constant("forecast_hour"),
        rightValue: constant(MAX_LEAD_HOURS),
      }),
    }),
  });
  const points = call("Collection", {
    features: {
      arrayValue: {
        values: Object.entries(STATIONS).map(([city, [lat, lon]]) =>
          call("Feature", {
            geometry: call("GeometryConstructors.Point", {
              coordinates: constant([lon, lat]),
            }),
            metadata: constant({ city }),
          }),
        ),
      },
    },
  });
  return {
    result: "0",
    values: {
      "0": call("Image.reduceRegions", {
        image: call("ImageCollection.toBands", {
          collection: call("Collection.map", {
            collection,
            baseAlgorithm: {
              functionDefinitionValue: { argumentNames: ["img"], body: "1" },
            },
          }),
        }),
        collection: points,
        reducer: call("Reducer.first", {}),
        scale: constant(5566),
      }),
      "1": call("Image.select", {
        input: { argumentReference: "img" },
        bandSelectors: constant([BAND]),
      }),
    },
  };
}

const isoSeconds = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19) + "Z";

function utcFromStamp(stamp: string): number {
  return Date.UTC(
    +stamp.slice(0, 4),
    +stamp.slice(4, 6) - 1,
    +stamp.slice(6, 8),
    +stamp.slice(8, 10),
    +stamp.slice(10, 12),
  );
}

export class WeatherNextFeed extends EventEmitter {
  private credentials: Credentials | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processed = new Set<number>();
  private stats = {
    lastInit: null as string | null,
    lastPublishedAt: null as string | null,
    lastFetchMs: 0,
    runsProcessed: 0,
    lastPollAt: null as string | null,
    lastError: null as string | null,
  };

  start(): void {
    if (this.timer) return;
    this.schedule(0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getStats() {
    return { ...this.stats };
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.poll()
        .catch((err) => {
          this.stats.lastError =
            err instanceof Error ? err.message : String(err);
          logger.error({ err }, "WeatherNext poll failed");
        })
        .finally(() => {
          if (this.timer) this.schedule(POLL_MS);
        });
    }, delay);
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    this.stats.lastPollAt = new Date(now).toISOString();
    const since = isoSeconds(now - LOOKBACK_MS);
    const listed = await this.request<{
      assets?: {
        startTime: string;
        properties?: { ingestion_time_utc?: number };
      }[];
    }>(
      `${EE_API}/${COLLECTION}:listAssets?` +
        new URLSearchParams({
          pageSize: "50",
          filter: `start_time > "${since}" AND properties.forecast_hour = ${READY_LEAD_HOURS}`,
        }),
    );
    for (const init of this.processed)
      if (init < now - LOOKBACK_MS) this.processed.delete(init);
    const ready = (listed.assets ?? [])
      .map((a) => ({
        init: Date.parse(a.startTime),
        publishedAt: (a.properties?.ingestion_time_utc ?? 0) * 1000,
      }))
      .filter(
        (a) =>
          a.publishedAt > 0 &&
          a.publishedAt + SETTLE_MS <= now &&
          !this.processed.has(a.init),
      )
      .sort((a, b) => a.init - b.init);

    for (const run of ready) {
      const started = Date.now();
      const series = await this.sample(isoSeconds(run.init), run.init);
      this.processed.add(run.init);
      this.stats = {
        ...this.stats,
        lastInit: new Date(
          Math.max(run.init, Date.parse(this.stats.lastInit ?? "0") || 0),
        ).toISOString(),
        lastPublishedAt: new Date(run.publishedAt).toISOString(),
        lastFetchMs: Date.now() - started,
        runsProcessed: this.stats.runsProcessed + 1,
        lastError: null,
      };
      logger.info(
        {
          init: new Date(run.init).toISOString(),
          stations: series.size,
          ms: this.stats.lastFetchMs,
        },
        "WeatherNext run fetched",
      );
      this.emit("run", { ...run, series } satisfies ForecastRun);
    }
  }

  private async sample(
    initIso: string,
    init: number,
  ): Promise<Map<string, number[]>> {
    const body = await this.request<{
      result: { features: { properties: Record<string, number | string> }[] };
    }>(`${EE_API}/projects/${getConfig().google.project}/value:compute`, {
      method: "POST",
      body: JSON.stringify({ expression: sampleExpression(initIso) }),
    });
    const series = new Map<string, number[]>();
    for (const { properties } of body.result.features) {
      const temps: number[] = [];
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value !== "number" || !key.endsWith(BAND)) continue;
        const lead = Math.round(
          (utcFromStamp(key.slice(13, 25)) - init) / 3_600_000,
        );
        if (lead >= 1 && lead <= MAX_LEAD_HOURS)
          temps[lead - 1] = value - 273.15;
      }
      series.set(String(properties.city), temps);
    }
    return series;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(120_000),
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "x-goog-user-project": getConfig().google.project,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok)
      throw new Error(
        `Earth Engine ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    return (await res.json()) as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    this.credentials ??= JSON.parse(
      readFileSync(getConfig().google.credentialsPath, "utf8"),
    ) as Credentials;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      body: new URLSearchParams({
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
        refresh_token: this.credentials.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok)
      throw new Error(
        `Google token refresh ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return this.token.value;
  }
}

let instance: WeatherNextFeed | null = null;
export function getWeatherNextFeed(): WeatherNextFeed {
  if (!instance) instance = new WeatherNextFeed();
  return instance;
}
