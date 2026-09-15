import { Router } from "express";
import { getStats } from "../db/links.js";
import { requireAuth } from "../lib/auth.js";

export const statsRouter: Router = Router();

/**
 * Owner-scoped: analytics are private to the link's owner. A link that exists
 * but belongs to someone else answers 404, same as one that doesn't exist.
 */
statsRouter.get("/stats/:code", requireAuth, async (req, res, next) => {
  try {
    const stats = await getStats(req.params.code ?? "", req.ownerId!);
    if (!stats) return res.status(404).json({ error: "no link found for that code" });
    return res.json(stats);
  } catch (err) {
    next(err);
  }
});
