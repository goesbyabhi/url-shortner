import { num, type Env } from "../env";

export interface CachedLink {
  url: string;
  expiresAt: string | null; // ISO
}

// Workers cannot reach a Redis instance; the edge Cache API fills the same role.
// Synthetic cache key, so the user-facing 302 stays uncached (clicks stay observable).
const cacheKey = (code: string) => new Request(`https://cache.snip.internal/link/${encodeURIComponent(code)}`);

/**
 * Cache-aside read. Entries self-evict: s-maxage is set to the link's remaining
 * lifetime, so an expired link can never be served from cache. Cached per
 * data center — closer to users than a single-region Redis.
 */
export async function getCachedLink(code: string): Promise<CachedLink | null> {
  const hit = await caches.default.match(cacheKey(code));
  if (!hit) return null;
  try {
    const parsed = (await hit.json()) as CachedLink;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      await caches.default.delete(cacheKey(code));
      return null;
    }
    return parsed;
  } catch {
    await caches.default.delete(cacheKey(code));
    return null;
  }
}

export async function setCachedLink(
  env: Env,
  code: string,
  url: string,
  expiresAt: Date | null
): Promise<void> {
  let ttl = num(env.CACHE_TTL_SEC, 86_400);
  if (expiresAt) {
    const remaining = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (remaining <= 0) return;
    ttl = Math.min(remaining, ttl);
  }
  const payload: CachedLink = { url, expiresAt: expiresAt?.toISOString() ?? null };
  const res = new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", "cache-control": `s-maxage=${ttl}` },
  });
  await caches.default.put(cacheKey(code), res);
}

export async function invalidateCachedLink(code: string): Promise<void> {
  await caches.default.delete(cacheKey(code));
}
