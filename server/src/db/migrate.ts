import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const require = createRequire(import.meta.url);
const sharedDir = dirname(require.resolve("@snip/shared/package.json"));
const MIGRATIONS_DIR = join(sharedDir, "migrations");

/** Applies pending .sql migrations once, tracked via schema_migrations. */
export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name as string)
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Waits for Postgres to accept connections (docker compose may still be booting). */
export async function waitForPostgres(maxAttempts = 30, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      if (attempt === maxAttempts) throw new Error("postgres unreachable");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
