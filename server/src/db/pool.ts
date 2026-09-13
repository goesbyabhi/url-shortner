import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  ...config.pg,
  ssl: config.pg.ssl ? { rejectUnauthorized: false } : undefined,
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
