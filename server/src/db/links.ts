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

export interface LinkSummary {
  code: string;
  originalUrl: string;
  createdAt: string;
  expiresAt: string | null;
  clicks: number;
}

export interface LinkPage {
  links: LinkSummary[];
  /** Pass back as ?cursor= to fetch the next page; null when exhausted */
  nextCursor: number | null;
  /** Total link count — only computed on the first page (null afterwards) */
  total: number | null;
}

interface ListRow {
  id: string;
  code: string;
  original_url: string;
  expires_at: Date | null;
  click_count: string;
  created_at: Date;
}

/**
 * Keyset ("cursor") pagination over the bigserial id, newest first.
 * Preferred over OFFSET here: the id index gives a stable page even when new
 * links are inserted between requests, and cost doesn't grow with page depth.
 */
export async function listLinks(limit: number, cursor: number | null): Promise<LinkPage> {
  const params: unknown[] = [];
  let where = "";
  if (cursor !== null) {
    params.push(cursor);
    where = `WHERE id < $${params.length}`;
  }
  params.push(limit + 1); // fetch one extra to detect a next page

  const [page, totals] = await Promise.all([
    query(
      `SELECT id, code, original_url, expires_at, click_count, created_at
       FROM links ${where}
       ORDER BY id DESC
       LIMIT $${params.length}`,
      params
    ),
    // Count only on the first page: an unconditional COUNT(*) per page is an
    // O(n) scan on every request, trivial to abuse.
    cursor === null ? query("SELECT count(*)::int AS total FROM links") : Promise.resolve(null),
  ]);

  const rows = page.rows as ListRow[];
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;

  return {
    links: visible.map((r) => ({
      code: r.code,
      originalUrl: r.original_url,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at?.toISOString() ?? null,
      clicks: Number(r.click_count),
    })),
    nextCursor: hasMore ? Number(visible[visible.length - 1]!.id) : null,
    total: totals ? (totals.rows[0]?.total as number) : null,
  };
}
