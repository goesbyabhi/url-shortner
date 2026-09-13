import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool(config.pg);

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
