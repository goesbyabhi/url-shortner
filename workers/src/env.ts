export interface Env {
  /** Static assets binding (the built SPA) */
  ASSETS: Fetcher;
  /** Per-IP fixed-window rate limiter (SQLite-backed Durable Object) */
  RATE_LIMITER: DurableObjectNamespace;
  /** Pooled, cached connection to Postgres */
  HYPERDRIVE: Hyperdrive;

  CODE_LENGTH: string;
  CODE_GEN_ATTEMPTS: string;
  CACHE_TTL_SEC: string;
  RATE_LIMIT_WINDOW_SEC: string;
  RATE_LIMIT_MAX: string;
  /** Comma-separated allowlist for browser calls; "*" allows any origin */
  CORS_ORIGIN: string;
}

/** Wrangler vars arrive as strings; parse with a fallback. */
export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Hono app type: bindings from wrangler, plus per-request variables.
 * `ownerId` is set by requireAuth and read by owner-scoped routes.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: { ownerId: number };
};
