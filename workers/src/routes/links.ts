import { Hono } from "hono";
import { isValidCode } from "@snip/shared";
import { deleteOwnedLink, listLinks, withClient } from "../db";
import { requireAuth } from "../lib/auth";
import { invalidateCachedLink } from "../lib/cache";
import type { AppEnv } from "../env";

export const linksRoutes = new Hono<AppEnv>();

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * GET /api/links?limit=&cursor= — the caller's links, newest first, keyset
 * paginated. Short URLs are stamped with the request origin, as in /shorten.
 */
linksRoutes.get("/links", requireAuth, async (c) => {
  const limitRaw = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const cursorRaw = c.req.query("cursor");
  let cursor: number | null = null;
  if (cursorRaw !== undefined) {
    const parsed = Number(cursorRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return c.json({ error: "cursor must be a positive integer" }, 400);
    }
    cursor = parsed;
  }

  const page = await withClient(c.env, (client) => listLinks(client, limit, cursor, c.get("ownerId")));
  const origin = new URL(c.req.url).origin;

  return c.json({
    ...page,
    links: page.links.map((l) => ({ ...l, shortUrl: `${origin}/${l.code}` })),
  });
});

/**
 * DELETE /api/links/:code — remove one of *your* links and stop it resolving.
 * Someone else's link answers 404 (never 403) and cache invalidation is
 * required, or the edge keeps serving the redirect.
 */
linksRoutes.delete("/links/:code", requireAuth, async (c) => {
  const code = c.req.param("code") ?? "";
  if (!isValidCode(code)) return c.json({ error: "not found" }, 404);

  const deleted = await withClient(c.env, (client) => deleteOwnedLink(client, code, c.get("ownerId")));
  await invalidateCachedLink(code);

  if (!deleted) return c.json({ error: "no link found for that code" }, 404);
  return c.body(null, 204);
});
