export interface RateVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSec: number;
}

interface RateLimitRequest {
  windowSec: number;
  max: number;
}

/**
 * Per-IP fixed-window counter as a Durable Object.
 *
 * Why a DO instead of Workers KV: KV is eventually consistent and capped at
 * ~1k writes/day on the free plan — a racy, self-defeating rate limiter. A DO
 * gives a single-threaded, strongly consistent counter per IP, and its alarm
 * clears storage when the window closes (one write per window, not per request).
 */
export class RateLimiter implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { windowSec, max } = (await request.json()) as RateLimitRequest;
    const now = Date.now();

    let windowStart = await this.state.storage.get<number>("windowStart");
    let count = (await this.state.storage.get<number>("count")) ?? 0;

    if (windowStart === undefined || now - windowStart >= windowSec * 1000) {
      windowStart = now;
      count = 0;
      await this.state.storage.setAlarm(now + windowSec * 1000);
    }

    count += 1;
    await this.state.storage.put({ windowStart, count });

    const verdict: RateVerdict = {
      allowed: count <= max,
      limit: max,
      remaining: Math.max(0, max - count),
      resetSec: Math.max(1, Math.ceil((windowStart + windowSec * 1000 - now) / 1000)),
    };
    return Response.json(verdict);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
