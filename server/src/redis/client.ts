import { Redis } from "ioredis";
import { config } from "../config.js";

export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  // Keep the process from hanging on shutdown if redis is unreachable.
  enableOfflineQueue: false,
});

redis.on("error", (err) => console.error("[redis]", err.message));
