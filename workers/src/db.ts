import pg from "pg";
import type { Env } from "./env";

/**
 * Hyperdrive owns the connection pool; we use one Client per request and
 * always close it. SQL below is identical to server/src/db/links.ts.
 */
export async function withClient<T>(env: Env, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

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

export async function insertLink(client: pg.Client, link: NewLink): Promise<void> {
  await client.query(
    `INSERT INTO links (code, original_url, is_custom, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [link.code, link.url, link.isCustom, link.expiresAt]
  );
}

export async function codeExists(client: pg.Client, code: string): Promise<boolean> {
  const r = await client.query("SELECT 1 FROM links WHERE code = $1", [code]);
  return r.rowCount === 1;
}

export async function getLinkByCode(client: pg.Client, code: string): Promise<LinkRow | null> {
  const r = await client.query("SELECT * FROM links WHERE code = $1", [code]);
  return (r.rows[0] as LinkRow | undefined) ?? null;
}

/** Analytics write path — fired via ctx.waitUntil, never blocks the redirect. */
export async function recordClick(
  client: pg.Client,
  code: string,
  referrer: string | null,
  userAgent: string | null
): Promise<void> {
  await client.query(`INSERT INTO click_events (code, referrer, user_agent) VALUES ($1, $2, $3)`, [
    code,
    referrer,
    userAgent,
  ]);
  await client.query(`UPDATE links SET click_count = click_count + 1 WHERE code = $1`, [code]);
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

export async function getStats(client: pg.Client, code: string): Promise<LinkStats | null> {
  const link = await getLinkByCode(client, code);
  if (!link) return null;

  const [byDay, topReferrers] = await Promise.all([
    client.query(
      `SELECT to_char(date_trunc('day', clicked_at), 'YYYY-MM-DD') AS day, count(*)::int AS clicks
       FROM click_events
       WHERE code = $1 AND clicked_at > now() - interval '14 days'
       GROUP BY 1
       ORDER BY 1`,
      [code]
    ),
    client.query(
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

export async function deleteLink(client: pg.Client, code: string): Promise<void> {
  await client.query("DELETE FROM links WHERE code = $1", [code]);
}

/** Cron-triggered sweep; lazy deletion at redirect time handles the rest. */
export async function sweepExpired(client: pg.Client): Promise<number> {
  const r = await client.query("DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at < now()");
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
 * Keyset pagination over the bigserial id — identical SQL to server/src/db/links.ts.
 * Stable under concurrent inserts and O(1) in page depth (unlike OFFSET).
 */
export async function listLinks(client: pg.Client, limit: number, cursor: number | null): Promise<LinkPage> {
  const params: unknown[] = [];
  let where = "";
  if (cursor !== null) {
    params.push(cursor);
    where = `WHERE id < $${params.length}`;
  }
  params.push(limit + 1); // one extra row tells us whether another page exists

  const page = await client.query(
    `SELECT id, code, original_url, expires_at, click_count, created_at
     FROM links ${where}
     ORDER BY id DESC
     LIMIT $${params.length}`,
    params
  );
  // Count only on the first page: an unconditional COUNT(*) per page is an
  // O(n) scan on every request, trivial to abuse.
  const totals = cursor === null ? await client.query("SELECT count(*)::int AS total FROM links") : null;

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
