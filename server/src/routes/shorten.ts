import { Router } from "express";
import { randomCode, validateAlias, validateExpiresInSeconds, validateUrl } from "@snip/shared";
import { config } from "../config.js";
import { codeExists, insertLink } from "../db/links.js";
import { requireAuth } from "../lib/auth.js";
import { setCachedLink } from "../lib/cache.js";
import { rateLimitMiddleware } from "../lib/ratelimit.js";

export const shortenRouter: Router = Router();

// Rate limit first (cheap Redis counter) so unauthenticated floods don't reach
// the key lookup, then resolve the owner.
shortenRouter.post("/shorten", rateLimitMiddleware, requireAuth, async (req, res, next) => {
  try {
    const ownerId = req.ownerId!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const url = validateUrl(body.url);
    if (!url.ok) return res.status(400).json({ error: url.error });

    let expiresAt: Date | null = null;
    if (body.expiresInSeconds !== undefined && body.expiresInSeconds !== null && body.expiresInSeconds !== 0) {
      const expiry = validateExpiresInSeconds(body.expiresInSeconds);
      if (!expiry.ok) return res.status(400).json({ error: expiry.error });
      expiresAt = new Date(Date.now() + expiry.seconds * 1000);
    }

    const alias = body.customAlias === undefined || body.customAlias === "" ? null : validateAlias(body.customAlias);
    if (alias && !alias.ok) return res.status(400).json({ error: alias.error });

    if (alias) {
      // Custom alias — check first for a clean 409, insert still guards against races.
      if (await codeExists(alias.alias)) {
        return res.status(409).json({ error: "that alias is already taken" });
      }
      try {
        await insertLink({ code: alias.alias, url: url.url, isCustom: true, expiresAt, ownerId });
      } catch (err) {
        if (isUniqueViolation(err)) return res.status(409).json({ error: "that alias is already taken" });
        throw err;
      }
      return void send(res, alias.alias, url.url, expiresAt);
    }

    // Random code — retry on the (astronomically rare) collision.
    for (let attempt = 0; attempt < config.codeGenAttempts; attempt++) {
      const code = randomCode(config.codeLength);
      try {
        await insertLink({ code, url: url.url, isCustom: false, expiresAt, ownerId });
        return void send(res, code, url.url, expiresAt);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return res.status(503).json({ error: "code generation failed after several attempts — try again" });
  } catch (err) {
    next(err);
  }
});

function send(res: import("express").Response, code: string, originalUrl: string, expiresAt: Date | null): void {
  void setCachedLink(code, originalUrl, expiresAt); // warm the cache for the first redirect
  res.status(201).json({
    code,
    shortUrl: `${config.baseUrl}/${code}`,
    originalUrl,
    expiresAt: expiresAt?.toISOString() ?? null,
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}
