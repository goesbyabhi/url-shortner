import { Router } from "express";
import { getLinkByCode, deleteLink } from "../db/links.js";
import { getCachedLink, invalidateCachedLink, setCachedLink } from "../lib/cache.js";
import { recordClickAsync } from "../lib/analytics.js";
import { isValidCode } from "../lib/validate.js";

export const redirectRouter: Router = Router();

/**
 * The hot read path. Order matters:
 *   1. Redis cache hit  -> immediate 302 (most traffic should end here)
 *   2. Postgres lookup  -> populate cache, 302
 *   3. 404 unknown / 410 expired (eagerly delete + invalidate cache)
 *
 * 302 (not 301) so browsers re-check on every click — analytics stay
 * accurate and alias/URL changes propagate instantly.
 */
redirectRouter.get("/:code", async (req, res, next) => {
  try {
    const code = req.params.code;
    if (!isValidCode(code)) return res.status(404).json({ error: "not found" });

    const referrer = req.get("referer") ?? null;
    const userAgent = req.get("user-agent") ?? null;

    // 1. Cache
    const cached = await getCachedLink(code);
    if (cached) {
      recordClickAsync(code, referrer, userAgent);
      return redirect(res, cached.url);
    }

    // 2. Database
    const link = await getLinkByCode(code);
    if (!link) return res.status(404).json({ error: "not found" });

    const expiresAt = link.expires_at;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      // 3. Expired — lazy delete, cascades to click_events
      await deleteLink(code).catch(() => undefined);
      await invalidateCachedLink(code);
      return res.status(410).json({ error: "this link has expired" });
    }

    void setCachedLink(code, link.original_url, expiresAt);
    recordClickAsync(code, referrer, userAgent);
    return redirect(res, link.original_url);
  } catch (err) {
    next(err);
  }
});

function redirect(res: import("express").Response, url: string): void {
  res.setHeader("Cache-Control", "no-cache");
  res.redirect(302, url);
}
