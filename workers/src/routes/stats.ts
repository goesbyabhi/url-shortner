import { Hono } from "hono";
import { getStats, withClient } from "../db";
import type { Env } from "../env";

export const statsRoutes = new Hono<{ Bindings: Env }>();

statsRoutes.get("/stats/:code", async (c) => {
  const code = c.req.param("code");
  const stats = await withClient(c.env, (client) => getStats(client, code));
  if (!stats) return c.json({ error: "no link found for that code" }, 404);
  return c.json(stats);
});
