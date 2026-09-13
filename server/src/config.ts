import "dotenv/config";

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  return process.env[name] ?? def;
}

export const config = {
  port: num("PORT", 3000),
  baseUrl: str("BASE_URL", "http://localhost:3000"),

  pg: {
    host: str("PGHOST", "localhost"),
    port: num("PGPORT", 5432),
    user: str("PGUSER", "shortener"),
    password: str("PGPASSWORD", "shortener"),
    database: str("PGDATABASE", "shortener"),
    max: 10,
  },

  redisUrl: str("REDIS_URL", "redis://localhost:6379"),

  codeLength: num("CODE_LENGTH", 7),
  codeGenAttempts: num("CODE_GEN_ATTEMPTS", 3),
  maxUrlLength: num("MAX_URL_LENGTH", 2048),

  cacheTtlSec: num("CACHE_TTL_SEC", 86_400),

  rateLimit: {
    windowSec: num("RATE_LIMIT_WINDOW_SEC", 60),
    max: num("RATE_LIMIT_MAX", 30),
  },

  sweepIntervalMs: num("SWEEP_INTERVAL_MS", 300_000),
} as const;
