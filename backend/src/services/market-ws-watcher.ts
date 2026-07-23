import { EventEmitter } from "events";
import WebSocket from "ws";
import { createModuleLogger } from "../utils/logger.js";
import { POLY_URLS } from "../types/index.js";
import type {
  ClobWsMessage,
  PriceUpdateEvent,
  BestBidAskEvent,
  MarketResolvedEvent,
} from "../interfaces/websocket-types.js";

const logger = createModuleLogger("market-ws-watcher");

const PING_INTERVAL_MS = 5_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export class MarketWebSocketWatcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscribedTokens = new Set<string>();
  private running = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private messageCount = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.ensureConnection();
    logger.info("Market WebSocket watcher started");
  }

  stop(): void {
    this.running = false;
    this.closeSocket();
    logger.info("Market WebSocket watcher stopped");
  }

  clear(): void {
    this.subscribedTokens.clear();
    this.closeSocket();
  }

  subscribe(tokenIds: string[]): void {
    const newTokens = tokenIds.filter((id) => !this.subscribedTokens.has(id));
    if (newTokens.length === 0) return;
    newTokens.forEach((id) => this.subscribedTokens.add(id));

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ assets_ids: newTokens, operation: "subscribe" }),
      );
      logger.info({ count: newTokens.length }, "Subscribed to new tokens");
    } else {
      this.ensureConnection();
    }
  }

  unsubscribe(tokenIds: string[]): void {
    const removed = tokenIds.filter((id) => this.subscribedTokens.delete(id));
    if (removed.length === 0) return;

    if (this.subscribedTokens.size === 0) {
      logger.info("No tokens left to watch, closing WebSocket");
      this.closeSocket();
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ assets_ids: removed, operation: "unsubscribe" }),
      );
      logger.info({ count: removed.length }, "Unsubscribed from tokens");
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSubscribedTokens(): Set<string> {
    return new Set(this.subscribedTokens);
  }

  getStats() {
    return {
      connected: this.isConnected(),
      subscribedTokens: this.subscribedTokens.size,
      messageCount: this.messageCount,
      reconnectAttempts: this.reconnectAttempt,
    };
  }

  private ensureConnection(): void {
    if (!this.running || this.subscribedTokens.size === 0) return;
    if (this.ws) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const ws = new WebSocket(POLY_URLS.CLOB_WS);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      ws.send(
        JSON.stringify({
          assets_ids: Array.from(this.subscribedTokens),
          type: "market",
          custom_feature_enabled: true,
        }),
      );
      logger.info(
        { tokenCount: this.subscribedTokens.size },
        "CLOB WebSocket connected and subscribed",
      );

      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("PING");
      }, PING_INTERVAL_MS);
    });

    ws.on("message", (rawData: WebSocket.Data) => {
      this.messageCount++;
      try {
        const text = rawData.toString();
        if (text === "PONG") return;
        if (text.startsWith("INVALID")) {
          logger.warn({ text: text.slice(0, 200) }, "CLOB rejected message");
          return;
        }
        if (text.includes('"event_type":"book"')) return;
        this.handleMessage(JSON.parse(text) as ClobWsMessage);
      } catch {
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      if (this.ws !== ws) return;
      this.discardSocket();
      logger.warn(
        { code, reason: reason.toString() },
        "CLOB WebSocket closed",
      );
      this.scheduleReconnect();
    });

    ws.on("error", (error: Error) => {
      logger.error({ error: error.message }, "CLOB WebSocket error");
    });
  }

  private discardSocket(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  private closeSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.discardSocket();
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }
    this.reconnectAttempt = 0;
  }

  private scheduleReconnect(): void {
    if (!this.running || this.subscribedTokens.size === 0) return;
    if (this.reconnectTimer) return;

    const delay =
      Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
        MAX_RECONNECT_DELAY_MS,
      ) +
      Math.random() * 300;
    this.reconnectAttempt++;
    logger.info(
      { delay: Math.round(delay), attempt: this.reconnectAttempt },
      "CLOB reconnecting",
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnection();
    }, delay);
  }

  private handleMessage(msg: ClobWsMessage): void {
    const ts =
      typeof msg.timestamp === "string"
        ? parseInt(msg.timestamp, 10)
        : (msg.timestamp ?? Date.now());

    switch (msg.event_type) {
      case "price_change":
        for (const pc of msg.price_changes ?? []) {
          this.emit("priceUpdate", {
            tokenId: pc.asset_id,
            bestBid: pc.best_bid,
            bestAsk: pc.best_ask,
            midpoint: (parseFloat(pc.best_bid) + parseFloat(pc.best_ask)) / 2,
            timestamp: ts,
          } satisfies PriceUpdateEvent);
        }
        break;

      case "best_bid_ask":
        if (msg.asset_id && msg.best_bid && msg.best_ask) {
          this.emit("bestBidAskUpdate", {
            tokenId: msg.asset_id,
            bestBid: msg.best_bid,
            bestAsk: msg.best_ask,
            spread: msg.spread ?? "0",
            timestamp: ts,
          } satisfies BestBidAskEvent);
        }
        break;

      case "market_resolved":
        if (msg.market && msg.winning_asset_id && msg.winning_outcome) {
          logger.info(
            { market: msg.market, winner: msg.winning_outcome },
            "Market resolved via WebSocket",
          );
          this.emit("marketResolved", {
            marketId: msg.id ?? "",
            conditionId: msg.market,
            winningAssetId: msg.winning_asset_id,
            winningOutcome: msg.winning_outcome,
            timestamp: ts,
          } satisfies MarketResolvedEvent);
        }
        break;
    }
  }
}

let instance: MarketWebSocketWatcher | null = null;
export function getMarketWebSocketWatcher(): MarketWebSocketWatcher {
  if (!instance) instance = new MarketWebSocketWatcher();
  return instance;
}
