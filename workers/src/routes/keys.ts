import { Hono } from "hono";
import { withClient } from "../db";
import { createKey } from "../keys";
import { rateLimitMiddleware } from "../lib/ratelimit";
import type { AppEnv } from "../env";

export const keysRoutes = new Hono<AppEnv>();

/**
 * POST /api/keys — provision an anonymous API key.
 *
 * The one unauthenticated write, so it is rate-limited: keys are cheap to mint
 * but shouldn't be farmable. The token is returned once; only its hash is stored.
 */
keysRoutes.post("/keys", rateLimitMiddleware, async (c) => {
  const key = await withClient(c.env, (client) => createKey(client));
  return c.json({ token: key.token, createdAt: new Date().toISOString() }, 201);
});
