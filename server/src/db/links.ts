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
  ownerId: number;
}

export async function insertLink(link: NewLink): Promise<void> {
  await query(
    `INSERT INTO links (code, original_url, is_custom, expires_at, owner_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [link.code, link.url, link.isCustom, link.expiresAt, link.ownerId]
  );
}

export async function codeExists(code: string): Promise<boolean> {
  const r = await query("SELECT 1 FROM links WHERE code = $1", [code]);
  return r.rowCount === 1;
}

/** Public lookup used by the redirect path — a short link is shareable. */
export async function getLinkByCode(code: string): Promise<LinkRow | null> {
  const r = await query("SELECT * FROM links WHERE code = $1", [code]);
  return (r.rows[0] as LinkRow | undefined) ?? null;
}

/**
 * Scoped lookup for owner-only operations (stats, delete). Returns null both
 * when the link is missing and when it belongs to someone else, so callers
 * answer 404 either way and never confirm that a code exists.
 */
export async function getOwnedLink(code: string, ownerId: number): Promise<LinkRow | null> {
  const r = await query("SELECT * FROM links WHERE code = $1 AND owner_id = $2", [code, ownerId]);
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

export async function getStats(code: string, ownerId: number): Promise<LinkStats | null> {
  const link = await getOwnedLink(code, ownerId);
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

/**
 * Delete a link by code regardless of owner (its click_events cascade). Used by
 * the expiry path, which must clean up whoever's link it is. Returns whether a
 * row existed.
 */
export async function deleteLink(code: string): Promise<boolean> {
  const r = await query("DELETE FROM links WHERE code = $1", [code]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Owner-scoped delete for the API. Returns false when the link doesn't exist
 * *or* isn't yours — the caller answers 404 either way, so the endpoint can't be
 * used to probe which codes exist.
 */
export async function deleteOwnedLink(code: string, ownerId: number): Promise<boolean> {
  const r = await query("DELETE FROM links WHERE code = $1 AND owner_id = $2", [code, ownerId]);
  return (r.rowCount ?? 0) > 0;
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
 * Keyset ("cursor") pagination over the bigserial id, newest first, scoped to
 * the caller's links. Preferred over OFFSET here: the id index gives a stable
 * page even when new links are inserted between requests, and cost doesn't grow
 * with page depth. `idx_links_owner_id (owner_id, id DESC)` serves both the
 * page query and the count.
 */
export async function listLinks(limit: number, cursor: number | null, ownerId: number): Promise<LinkPage> {
  const params: unknown[] = [ownerId];
  let where = "WHERE owner_id = $1";
  if (cursor !== null) {
    params.push(cursor);
    where += ` AND id < $${params.length}`;
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
    cursor === null
      ? query("SELECT count(*)::int AS total FROM links WHERE owner_id = $1", [ownerId])
      : Promise.resolve(null),
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
