import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Env } from "./env";
import { sweepExpired, withClient } from "./db";
import { healthRoutes } from "./routes/health";
import { keysRoutes } from "./routes/keys";
import { shortenRoutes } from "./routes/shorten";
import { statsRoutes } from "./routes/stats";
import { linksRoutes } from "./routes/links";
import { redirectRoutes } from "./routes/redirect";

export { RateLimiter } from "./ratelimit-do";

const app = new Hono<AppEnv>();

/**
 * CORS for the API. Served same-origin by default (the Worker hosts the SPA), but
 * a browser calling this API from another origin — Cloudflare Pages, a local Vite
 * dev server, a mobile shell — needs this or every request dies in the browser
 * while curl keeps working. Auth is a Bearer token in a header, not a cookie, so
 * there are no ambient credentials to protect: default to "*", restrict with the
 * CORS_ORIGIN var when you want to.
 */
app.use("/api/*", cors({
  origin: (origin, c) => {
    const allowed = (c.env.CORS_ORIGIN ?? "*")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (allowed.includes("*")) return origin ?? "*";
    return allowed.includes(origin ?? "") ? origin : "";
  },
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86_400,
}));

// API — /api/keys (rate-limited), /api/shorten (rate-limited + auth),
// /api/stats/:code, /api/links (auth), /api/health
app.route("/api", keysRoutes);
app.route("/api", shortenRoutes);
app.route("/api", statsRoutes);
app.route("/api", linksRoutes);
app.route("/api", healthRoutes);

// Unknown /api paths are JSON 404s (never the SPA fallback)
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// Short codes — GET /:code
app.route("/", redirectRoutes);

// Everything else (SPA routes, favicon, …) is served from the assets binding
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),

  /** Cron trigger (every 5 min): delete expired rows. Lazy delete handles the rest. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      withClient(env, (client) => sweepExpired(client))
        .then((n) => {
          if (n > 0) console.log(`sweep: removed ${n} expired link(s)`);
        })
        .catch((err) => console.error("[sweep]", err instanceof Error ? err.message : err))
    );
  },
};
