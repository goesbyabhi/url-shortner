import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { redis } from "../redis/client.js";

export interface RateVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSec: number;
}

/**
 * Redis fixed-window counter: rl:{ip}:{windowIndex}. O(1) work per request.
 * Tradeoffs vs. token bucket / sliding window are covered in the README.
 */
export async function checkRateLimit(ip: string): Promise<RateVerdict> {
  const { windowSec, max } = config.rateLimit;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowIndex = Math.floor(nowSec / windowSec);
  const resetSec = windowSec - (nowSec % windowSec);
  const key = `rl:${ip}:${windowIndex}`;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);

  return {
    allowed: count <= max,
    limit: max,
    remaining: Math.max(0, max - count),
    resetSec,
  };
}

export function rateLimitHeaders(res: Response, v: RateVerdict): void {
  res.setHeader("X-RateLimit-Limit", v.limit);
  res.setHeader("X-RateLimit-Remaining", v.remaining);
  res.setHeader("X-RateLimit-Reset", v.resetSec);
}

/** Middleware for the shorten endpoint only — reads are not limited. Fails open: a Redis outage degrades rate limiting rather than availability. */
export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  let verdict: RateVerdict;
  try {
    verdict = await checkRateLimit(req.ip ?? "unknown");
  } catch (err) {
    console.warn("[ratelimit] redis unavailable — failing open:", err instanceof Error ? err.message : err);
    return next();
  }
  rateLimitHeaders(res, verdict);
  if (!verdict.allowed) {
    res.setHeader("Retry-After", verdict.resetSec);
    res.status(429).json({
      error: `rate limit exceeded — ${verdict.limit} requests per ${config.rateLimit.windowSec}s. Retry in ${verdict.resetSec}s.`,
    });
    return;
  }
  next();
}
