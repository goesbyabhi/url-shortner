import { Hono } from "hono";
import { requireAuth } from "../lib/auth";
import { getStats, withClient } from "../db";
import type { AppEnv } from "../env";

export const statsRoutes = new Hono<AppEnv>();

/**
 * Owner-scoped: analytics are private to the link's owner. A link that exists
 * but belongs to someone else answers 404, same as one that doesn't exist.
 */
statsRoutes.get("/stats/:code", requireAuth, async (c) => {
  const code = c.req.param("code") ?? "";
  const stats = await withClient(c.env, (client) => getStats(client, code, c.get("ownerId")));
  if (!stats) return c.json({ error: "no link found for that code" }, 404);
  return c.json(stats);
});
