import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { runMigrations, waitForPostgres } from "./db/migrate.js";
import { sweepExpired } from "./db/links.js";
import { redis } from "./redis/client.js";
import { shortenRouter } from "./routes/shorten.js";
import { statsRouter } from "./routes/stats.js";
import { linksRouter } from "./routes/links.js";
import { keysRouter } from "./routes/keys.js";
import { redirectRouter } from "./routes/redirect.js";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST"],
  })
);
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", async (_req, res) => {
  const [pgOk, redisOk] = await Promise.all([
    pool.query("SELECT 1").then(() => true, () => false),
    redis.ping().then((r) => r === "PONG", () => false),
  ]);
  res.status(pgOk && redisOk ? 200 : 503).json({ status: "ok", pg: pgOk, redis: redisOk });
});

app.use("/api", keysRouter);
app.use("/api", shortenRouter);
app.use("/api", statsRouter);
app.use("/api", linksRouter);

// Unknown /api path — JSON 404 before the redirect catch-all sees it
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// Hot path: GET /:code — mounted last
app.use("/", redirectRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err instanceof Error ? err.stack : err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal server error" });
});

let sweepTimer: ReturnType<typeof setInterval> | undefined;

async function main(): Promise<void> {
  console.log("waiting for postgres…");
  await waitForPostgres();
  const ran = await runMigrations();
  if (ran.length > 0) console.log("migrations applied:", ran.join(", "));

  // Periodic expiry sweep (lazy delete at redirect time handles the rest)
  const sweep = () => {
    sweepExpired()
      .then((n) => n > 0 && console.log(`sweep: removed ${n} expired link(s)`))
      .catch((err) => console.error("[sweep]", err instanceof Error ? err.message : err));
  };
  sweep();
  sweepTimer = setInterval(sweep, config.sweepIntervalMs);

  app.listen(config.port, () => {
    console.log(`api ready on :${config.port} — short urls at ${config.baseUrl}/:code`);
  });
}

async function shutdown(): Promise<void> {
  console.log("\nshutting down…");
  if (sweepTimer) clearInterval(sweepTimer);
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void main();
