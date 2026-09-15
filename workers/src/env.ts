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
}

/** Wrangler vars arrive as strings; parse with a fallback. */
export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
