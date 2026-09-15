/**
 * Operator CLI: apply pending migrations, then exit.
 * Works against any Postgres (local docker or hosted) via the same env vars
 * the server reads — the workers deployment reuses this to migrate Neon.
 *
 *   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... PGSSL=true npm run migrate -w server
 */
import { runMigrations, waitForPostgres } from "./migrate.js";
import { pool } from "./pool.js";

const ran = await waitForPostgres().then(runMigrations);
console.log(ran.length > 0 ? `migrations applied: ${ran.join(", ")}` : "migrations up to date");
await pool.end();
