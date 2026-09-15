import { recordClick, withClient } from "../db";
import type { Env } from "../env";

/** Structural subset of the runtime ExecutionContext (Hono's version is compatible). */
interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Fire-and-forget analytics via ctx.waitUntil: the redirect response never waits
 * on (or fails because of) the analytics path, but the write is guaranteed to
 * run after the response is sent — the Workers analogue of the server's
 * un-awaited insert.
 */
export function recordClickAsync(
  env: Env,
  ctx: WaitUntil,
  code: string,
  referrer: string | null,
  userAgent: string | null
): void {
  ctx.waitUntil(
    withClient(env, (client) => recordClick(client, code, referrer, userAgent)).catch((err) => {
      console.error("[analytics] failed to record click:", err instanceof Error ? err.message : err);
    })
  );
}
