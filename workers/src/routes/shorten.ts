import { Hono } from "hono";
import { randomCode, validateAlias, validateExpiresInSeconds, validateUrl } from "@snip/shared";
import { codeExists, insertLink, withClient } from "../db";
import { setCachedLink } from "../lib/cache";
import { rateLimitMiddleware } from "../lib/ratelimit";
import { num, type Env } from "../env";

export const shortenRoutes = new Hono<{ Bindings: Env }>();

shortenRoutes.post("/shorten", rateLimitMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const url = validateUrl(body.url);
  if (!url.ok) return c.json({ error: url.error }, 400);

  let expiresAt: Date | null = null;
  if (body.expiresInSeconds !== undefined && body.expiresInSeconds !== null && body.expiresInSeconds !== 0) {
    const expiry = validateExpiresInSeconds(body.expiresInSeconds);
    if (!expiry.ok) return c.json({ error: expiry.error }, 400);
    expiresAt = new Date(Date.now() + expiry.seconds * 1000);
  }

  const alias = body.customAlias === undefined || body.customAlias === "" ? null : validateAlias(body.customAlias);
  if (alias && !alias.ok) return c.json({ error: alias.error }, 400);

  const codeLength = num(c.env.CODE_LENGTH, 7);
  const attempts = num(c.env.CODE_GEN_ATTEMPTS, 3);

  const created = await withClient(c.env, async (client) => {
    if (alias) {
      if (await codeExists(client, alias.alias)) return { kind: "conflict" as const };
      try {
        await insertLink(client, { code: alias.alias, url: url.url, isCustom: true, expiresAt });
        return { kind: "ok" as const, code: alias.alias };
      } catch (err) {
        if (isUniqueViolation(err)) return { kind: "conflict" as const };
        throw err;
      }
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      const code = randomCode(codeLength);
      try {
        await insertLink(client, { code, url: url.url, isCustom: false, expiresAt });
        return { kind: "ok" as const, code };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return { kind: "exhausted" as const };
  });

  if (created.kind === "conflict") return c.json({ error: "that alias is already taken" }, 409);
  if (created.kind === "exhausted") {
    return c.json({ error: "code generation failed after several attempts — try again" }, 503);
  }

  // Warm the edge cache so the first click skips Postgres.
  c.executionCtx.waitUntil(setCachedLink(c.env, created.code, url.url, expiresAt));

  // No BASE_URL config: short URLs are stamped with the origin the request
  // arrived on, so workers.dev, custom domains, and previews all just work.
  const origin = new URL(c.req.url).origin;
  return c.json(
    {
      code: created.code,
      shortUrl: `${origin}/${created.code}`,
      originalUrl: url.url,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
    201
  );
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}
