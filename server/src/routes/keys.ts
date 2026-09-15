import { Router } from "express";
import { createKey } from "../db/keys.js";
import { rateLimitMiddleware } from "../lib/ratelimit.js";

export const keysRouter: Router = Router();

/**
 * POST /api/keys — provision an anonymous API key.
 *
 * This is the one unauthenticated write, so it is rate-limited: keys are cheap
 * for us to mint but shouldn't be farmable. The token is returned once and
 * stored client-side; the server keeps only its hash.
 */
keysRouter.post("/keys", rateLimitMiddleware, async (_req, res, next) => {
  try {
    const key = await createKey();
    return res.status(201).json({ token: key.token, createdAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});
