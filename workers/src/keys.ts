import { generateToken, hashToken } from "@snip/shared";
import type pg from "pg";

/**
 * Issues a new anonymous key. The raw token is returned exactly once — only its
 * hash is persisted, so it can never be recovered from the database.
 */
export async function createKey(client: pg.Client): Promise<{ id: number; token: string }> {
  const token = generateToken();
  const r = await client.query("INSERT INTO api_keys (token_hash) VALUES ($1) RETURNING id", [hashToken(token)]);
  return { id: Number((r.rows[0] as { id: string }).id), token };
}

/** Resolves a bearer token to its owner, or null when the key is unknown. */
export async function findOwnerIdByTokenHash(client: pg.Client, hash: string): Promise<number | null> {
  const r = await client.query("SELECT id FROM api_keys WHERE token_hash = $1", [hash]);
  const row = r.rows[0] as { id: string } | undefined;
  return row ? Number(row.id) : null;
}
