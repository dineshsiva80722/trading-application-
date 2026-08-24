import Redis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";

const sanitizeUrl = (url?: string): string => {
  if (!url) return "";
  let trimmed = url.trim();
  if (trimmed.startsWith("hhttps://")) {
    trimmed = trimmed.replace(/^h+https:\/\//, "https://");
  }
  return trimmed;
};

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const rawUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashUrl = sanitizeUrl(rawUpstashUrl);
const upstashToken = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

class MockRedis {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return "OK";
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    this.store.set(key, value);
    setTimeout(() => this.store.delete(key), seconds * 1000);
    return "OK";
  }

  async ping(): Promise<string> {
    return "PONG (In-Memory Mock Mode)";
  }

  on(event: string, callback: (...args: any[]) => void): this {
    if (event === "connect") {
      setTimeout(() => callback(), 50);
    }
    return this;
  }

  disconnect() {}
}

let activeClient: any;

try {
  // Try Upstash REST API first if credentials are available
  if (upstashUrl && upstashToken) {
    try {
      activeClient = new UpstashRedis({
        url: upstashUrl,
        token: upstashToken,
      });
      console.log(`[Redis] REAL UPSTASH REDIS connected successfully (${upstashUrl}).`);
    } catch (upstashError: any) {
      console.warn("[Redis] Upstash connection failed:", upstashError?.message || upstashError);
      throw upstashError;
    }
  } else {
    // Fall back to standard Redis connection
    console.log(`[Redis] Connecting to standard Redis at ${redisUrl}...`);
    activeClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });

    activeClient.on("error", (err: any) => {
      if (!(activeClient instanceof MockRedis)) {
        console.warn("[Redis] Standard Redis connection failed. Falling back to IN-MEMORY MOCK REDIS.");
        const oldClient = activeClient;
        activeClient = new MockRedis();
        try {
          oldClient.disconnect();
        } catch (e) {
          // ignore error during disconnect
        }
      }
    });
  }
} catch (error: any) {
  console.warn("[Redis] Initialization failed. Falling back to IN-MEMORY MOCK REDIS cache.");
  activeClient = new MockRedis();
}

// Proxy wrapper to expose the active client dynamically to all modules importing it
const proxy = new Proxy({} as any, {
  get(target, prop) {
    const value = activeClient[prop];
    if (typeof value === "function") {
      return function (...args: any[]) {
        return value.apply(activeClient, args);
      };
    }
    return value;
  }
});

export default proxy;
export { Redis };
