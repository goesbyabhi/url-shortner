import { Hono } from "hono";
import type { Env } from "./env";
import { sweepExpired, withClient } from "./db";
import { healthRoutes } from "./routes/health";
import { shortenRoutes } from "./routes/shorten";
import { statsRoutes } from "./routes/stats";
import { redirectRoutes } from "./routes/redirect";

export { RateLimiter } from "./ratelimit-do";

const app = new Hono<{ Bindings: Env }>();

// API — /api/shorten (rate-limited), /api/stats/:code, /api/health
app.route("/api", shortenRoutes);
app.route("/api", statsRoutes);
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
