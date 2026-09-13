import { Router } from "express";
import { config } from "../config.js";
import { codeExists, insertLink } from "../db/links.js";
import { randomCode } from "../lib/base62.js";
import { setCachedLink } from "../lib/cache.js";
import { rateLimitMiddleware } from "../lib/ratelimit.js";
import { validateAlias, validateExpiresInSeconds, validateUrl } from "../lib/validate.js";

export const shortenRouter: Router = Router();

shortenRouter.post("/shorten", rateLimitMiddleware, async (req, res, next) => {
  try {
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
        await insertLink({ code: alias.alias, url: url.url, isCustom: true, expiresAt });
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
        await insertLink({ code, url: url.url, isCustom: false, expiresAt });
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
