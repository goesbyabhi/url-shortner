import { Hono } from "hono";
import type { Context } from "hono";
import { isValidCode } from "@snip/shared";
import { deleteLink, getLinkByCode, withClient } from "../db";
import { getCachedLink, invalidateCachedLink, setCachedLink } from "../lib/cache";
import { recordClickAsync } from "../lib/analytics";
import type { Env } from "../env";

export const redirectRoutes = new Hono<{ Bindings: Env }>();

/**
 * The hot read path, same order as the server implementation:
 *   1. edge Cache API hit -> immediate 302
 *   2. Hyperdrive/Postgres lookup -> warm cache, 302
 *   3. 404 unknown / 410 expired (eager delete + cache invalidate)
 *
 * Paths that don't look like codes (favicon.ico, SPA routes) fall through to
 * static assets instead of 404ing.
 */
redirectRoutes.get("/:code", async (c) => {
  const code = c.req.param("code");
  if (!isValidCode(code)) return c.env.ASSETS.fetch(c.req.raw);

  const referrer = c.req.header("referer") ?? null;
  const userAgent = c.req.header("user-agent") ?? null;

  const cached = await getCachedLink(code);
  if (cached) {
    recordClickAsync(c.env, c.executionCtx, code, referrer, userAgent);
    return redirect(c, cached.url);
  }

  const link = await withClient(c.env, (client) => getLinkByCode(client, code));
  if (!link) return c.json({ error: "not found" }, 404);

  const expiresAt = link.expires_at;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    await withClient(c.env, (client) => deleteLink(client, code)).catch(() => undefined);
    await invalidateCachedLink(code);
    return c.json({ error: "this link has expired" }, 410);
  }

  c.executionCtx.waitUntil(setCachedLink(c.env, code, link.original_url, expiresAt));
  recordClickAsync(c.env, c.executionCtx, code, referrer, userAgent);
  return redirect(c, link.original_url);
});

function redirect(c: Context<{ Bindings: Env }>, url: string): Response {
  c.header("Cache-Control", "no-cache");
  return c.redirect(url, 302);
}
