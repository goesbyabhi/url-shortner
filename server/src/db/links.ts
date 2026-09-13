import { query } from "./pool.js";

export interface LinkRow {
  code: string;
  original_url: string;
  is_custom: boolean;
  expires_at: Date | null;
  click_count: string;
  created_at: Date;
}

export interface NewLink {
  code: string;
  url: string;
  isCustom: boolean;
  expiresAt: Date | null;
}

export async function insertLink(link: NewLink): Promise<void> {
  await query(
    `INSERT INTO links (code, original_url, is_custom, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [link.code, link.url, link.isCustom, link.expiresAt]
  );
}

export async function codeExists(code: string): Promise<boolean> {
  const r = await query("SELECT 1 FROM links WHERE code = $1", [code]);
  return r.rowCount === 1;
}

export async function getLinkByCode(code: string): Promise<LinkRow | null> {
  const r = await query("SELECT * FROM links WHERE code = $1", [code]);
  return (r.rows[0] as LinkRow | undefined) ?? null;
}

/** 409-style conflict check for custom aliases. */
export async function getAliasOwner(code: string): Promise<LinkRow | null> {
  const r = await query("SELECT * FROM links WHERE code = $1", [code]);
  return (r.rows[0] as LinkRow | undefined) ?? null;
}

/**
 * Analytics write path: insert a click event and bump the denormalized
 * counter. Called fire-and-forget — never blocks the redirect.
 */
export async function recordClick(code: string, referrer: string | null, userAgent: string | null): Promise<void> {
  await query(
    `INSERT INTO click_events (code, referrer, user_agent) VALUES ($1, $2, $3)`,
    [code, referrer, userAgent]
  );
  await query(`UPDATE links SET click_count = click_count + 1 WHERE code = $1`, [code]);
}

export interface LinkStats {
  code: string;
  originalUrl: string;
  createdAt: string;
  expiresAt: string | null;
  totalClicks: number;
  byDay: { day: string; clicks: number }[];
  topReferrers: { referrer: string; clicks: number }[];
}

export async function getStats(code: string): Promise<LinkStats | null> {
  const link = await getLinkByCode(code);
  if (!link) return null;

  const [byDay, topReferrers] = await Promise.all([
    query(
      `SELECT to_char(date_trunc('day', clicked_at), 'YYYY-MM-DD') AS day, count(*)::int AS clicks
       FROM click_events
       WHERE code = $1 AND clicked_at > now() - interval '14 days'
       GROUP BY 1
       ORDER BY 1`,
      [code]
    ),
    query(
      `SELECT coalesce(referrer, '(direct)') AS referrer, count(*)::int AS clicks
       FROM click_events
       WHERE code = $1
       GROUP BY 1
       ORDER BY 2 DESC, 1
       LIMIT 5`,
      [code]
    ),
  ]);

  return {
    code: link.code,
    originalUrl: link.original_url,
    createdAt: link.created_at.toISOString(),
    expiresAt: link.expires_at?.toISOString() ?? null,
    totalClicks: Number(link.click_count),
    byDay: byDay.rows.map((r) => ({ day: r.day as string, clicks: r.clicks as number })),
    topReferrers: topReferrers.rows.map((r) => ({
      referrer: r.referrer as string,
      clicks: r.clicks as number,
    })),
  };
}

/** Eagerly delete an expired link (events cascade). Complements the periodic sweep. */
export async function deleteLink(code: string): Promise<void> {
  await query("DELETE FROM links WHERE code = $1", [code]);
}

/** Periodic sweep: remove expired links so lookups and stats stay clean. */
export async function sweepExpired(): Promise<number> {
  const r = await query("DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at < now()");
  return r.rowCount ?? 0;
}
