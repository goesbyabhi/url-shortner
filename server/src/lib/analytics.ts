import { recordClick } from "../db/links.js";

/**
 * Fire-and-forget analytics write. The redirect response must never wait
 * on (or fail because of) the analytics path — errors are logged and dropped.
 * Alternative designs (queue + worker, Redis-buffered batches) in README.
 */
export function recordClickAsync(code: string, referrer: string | null, userAgent: string | null): void {
  recordClick(code, referrer, userAgent).catch((err) => {
    console.error("[analytics] failed to record click:", err instanceof Error ? err.message : err);
  });
}
