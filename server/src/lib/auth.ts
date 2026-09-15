import type { NextFunction, Request, Response } from "express";
import { hashToken } from "./token.js";
import { findOwnerIdByTokenHash } from "../db/keys.js";

/**
 * Resolves "Authorization: Bearer <token>" to an owner id and attaches it to
 * the request. Middleware, not per-route logic, so no handler can forget it.
 *
 * The key lookup is one indexed query per authenticated request; caching the
 * hash -> owner mapping (Redis / Cache API) is the obvious next optimization if
 * this ever becomes hot, at the cost of cache invalidation on key revocation.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

    if (!token) {
      res.status(401).json({ error: "missing api key — send Authorization: Bearer <token>" });
      return;
    }

    const ownerId = await findOwnerIdByTokenHash(hashToken(token));
    if (ownerId === null) {
      res.status(401).json({ error: "invalid api key" });
      return;
    }

    req.ownerId = ownerId;
    next();
  } catch (err) {
    next(err);
  }
}
