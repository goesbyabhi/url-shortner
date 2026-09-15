import { Router } from "express";
import { isValidCode } from "@snip/shared";
import { config } from "../config.js";
import { deleteLink, listLinks } from "../db/links.js";
import { invalidateCachedLink } from "../lib/cache.js";

export const linksRouter: Router = Router();

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * GET /api/links?limit=&cursor= — newest first, keyset paginated.
 *
 * NOTE: unauthenticated, so in a real product this must be scoped to the caller
 * (API key / account) or it becomes a link-enumeration endpoint. The demo caps
 * the page size and exposes only link metadata, no click data.
 */
linksRouter.get("/links", async (req, res, next) => {
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

    const page = await listLinks(limit, cursor);
    return res.json({
      ...page,
      links: page.links.map((l) => ({ ...l, shortUrl: `${config.baseUrl}/${l.code}` })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/links/:code — remove a link and stop it resolving immediately.
 *
 * Cache invalidation is not optional: without it the short code keeps
 * redirecting from cache until its TTL expires.
 *
 * Unauthenticated, like the listing — in a real product this must sit behind
 * the same account scoping, or anyone can delete anyone's links.
 */
linksRouter.delete("/links/:code", async (req, res, next) => {
  try {
    const code = req.params.code;
    if (!isValidCode(code)) return res.status(404).json({ error: "not found" });

    const deleted = await deleteLink(code);
    await invalidateCachedLink(code);

    if (!deleted) return res.status(404).json({ error: "no link found for that code" });
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
});
