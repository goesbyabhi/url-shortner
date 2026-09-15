import { hashToken } from "@snip/shared";
import type { Context, Next } from "hono";
import { findOwnerIdByTokenHash } from "../keys";
import { withClient } from "../db";
import type { AppEnv } from "../env";

/**
 * Resolves "Authorization: Bearer <token>" to an owner and stashes it on the
 * request context. Middleware, not per-route logic, so no handler can forget it.
 *
 * One indexed lookup per authenticated request; caching hash -> owner in the
 * Cache API is the obvious next optimization if this becomes hot.
 */
export async function requireAuth(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (!token) {
    return c.json({ error: "missing api key — send Authorization: Bearer <token>" }, 401);
  }

  const ownerId = await withClient(c.env, (client) => findOwnerIdByTokenHash(client, hashToken(token)));
  if (ownerId === null) {
    return c.json({ error: "invalid api key" }, 401);
  }

  c.set("ownerId", ownerId);
  return next();
}
