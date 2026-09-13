import { config } from "../config.js";
import { redis } from "../redis/client.js";

export interface CachedLink {
  url: string;
  expiresAt: string | null; // ISO
}

const key = (code: string) => `url:${code}`;

/**
 * Cache-aside read. Entries self-evict: the TTL is set to the link's
 * remaining lifetime, so an expired link can never be served from cache.
 */
export async function getCachedLink(code: string): Promise<CachedLink | null> {
  const raw = await redis.get(key(code)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedLink;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      await redis.del(key(code)).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    await redis.del(key(code)).catch(() => undefined);
    return null;
  }
}

export async function setCachedLink(code: string, url: string, expiresAt: Date | null): Promise<void> {
  let ttl = config.cacheTtlSec;
  if (expiresAt) {
    const remaining = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (remaining <= 0) return; // expired already — nothing to cache
    ttl = Math.min(remaining, config.cacheTtlSec);
  }
  const payload: CachedLink = { url, expiresAt: expiresAt?.toISOString() ?? null };
  await redis.set(key(code), JSON.stringify(payload), "EX", ttl).catch(() => undefined);
}

/** Invalidate when a code is deleted (expiry cleanup). */
export async function invalidateCachedLink(code: string): Promise<void> {
  await redis.del(key(code)).catch(() => undefined);
}
