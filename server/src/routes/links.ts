import { Router } from "express";
import { config } from "../config.js";
import { listLinks } from "../db/links.js";

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
