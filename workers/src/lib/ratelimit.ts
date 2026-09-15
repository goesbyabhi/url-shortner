import type { Context, Next } from "hono";
import { num, type AppEnv } from "../env";
import type { RateVerdict } from "../ratelimit-do";

type Ctx = Context<AppEnv>;

/**
 * Same fixed-window policy as the server (30 requests / 60s / IP), backed by a
 * Durable Object so the counter is strongly consistent across all edge locations.
 * Fails open: a DO outage degrades rate limiting rather than availability.
 */
export async function rateLimitMiddleware(c: Ctx, next: Next): Promise<Response | void> {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const windowSec = num(c.env.RATE_LIMIT_WINDOW_SEC, 60);
  const max = num(c.env.RATE_LIMIT_MAX, 30);

  let verdict: RateVerdict;
  try {
    const stub = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(`ip:${ip}`));
    const res = await stub.fetch("https://rate-limiter/check", {
      method: "POST",
      body: JSON.stringify({ windowSec, max }),
    });
    verdict = (await res.json()) as RateVerdict;
  } catch (err) {
    console.warn("[ratelimit] durable object unavailable — failing open:", err instanceof Error ? err.message : err);
    return next();
  }

  c.header("X-RateLimit-Limit", String(verdict.limit));
  c.header("X-RateLimit-Remaining", String(verdict.remaining));
  c.header("X-RateLimit-Reset", String(verdict.resetSec));

  if (!verdict.allowed) {
    c.header("Retry-After", String(verdict.resetSec));
    return c.json(
      { error: `rate limit exceeded — ${verdict.limit} requests per ${windowSec}s. Retry in ${verdict.resetSec}s.` },
      429
    );
  }
  return next();
}
