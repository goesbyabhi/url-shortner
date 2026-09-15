import { Router } from "express";
import { isValidCode } from "@snip/shared";
import { config } from "../config.js";
import { deleteOwnedLink, listLinks } from "../db/links.js";
import { requireAuth } from "../lib/auth.js";
import { invalidateCachedLink } from "../lib/cache.js";

export const linksRouter: Router = Router();

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * GET /api/links?limit=&cursor= — the caller's links, newest first, keyset
 * paginated. Scoped to the API key that created them, so the endpoint is no
 * longer a way to enumerate every link in the system.
 */
linksRouter.get("/links", requireAuth, async (req, res, next) => {
  try {
    const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const cursorRaw = req.query.cursor;
    let cursor: number | null = null;
    if (cursorRaw !== undefined) {
      const parsed = Number(cursorRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return res.status(400).json({ error: "cursor must be a positive integer" });
      }
      cursor = parsed;
    }

    const page = await listLinks(limit, cursor, req.ownerId!);
    return res.json({
      ...page,
      links: page.links.map((l) => ({ ...l, shortUrl: `${config.baseUrl}/${l.code}` })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/links/:code — remove one of *your* links and stop it resolving.
 *
 * Two things are deliberate here:
 * - a link owned by someone else answers 404, never 403, so the endpoint can't
 *   be used to discover which codes exist
 * - cache invalidation is not optional, or the short code keeps redirecting
 *   until its TTL expires
 */
linksRouter.delete("/links/:code", requireAuth, async (req, res, next) => {
  try {
    const code = req.params.code ?? "";
    if (!isValidCode(code)) return res.status(404).json({ error: "not found" });

    const deleted = await deleteOwnedLink(code, req.ownerId!);
    await invalidateCachedLink(code);

    if (!deleted) return res.status(404).json({ error: "no link found for that code" });
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
});
