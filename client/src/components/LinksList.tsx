import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { listLinks } from "../api";
import { ChartIcon, CheckIcon, CopyIcon, ExternalIcon, RefreshIcon } from "../lib/icons";
import { copyText, formatExpiry, timeAgo, truncateMiddle } from "../lib/format";
import type { LinkSummary } from "../types";

const PAGE_SIZE = 20;

/**
 * Server-backed list of every shortened link, newest first.
 * Replaces the old localStorage recents: that list was per-device, silently
 * capped at 10, and lost on a cache clear.
 */
export function LinksList({
  refreshKey,
  onStats,
}: {
  refreshKey: number;
  onStats: (code: string) => void;
}) {
  const [links, setLinks] = useState<LinkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async (cursorArg: number | null, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listLinks(PAGE_SIZE, cursorArg ?? undefined);
      setLinks((prev) => (append ? [...prev, ...page.links] : page.links));
      if (page.total !== null) setTotal(page.total);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load links");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload the first page whenever a link is created, or on demand.
  useEffect(() => {
    void load(null, false);
  }, [load, refreshKey]);

  // Clicking a short link opens a new tab; coming back should show fresh counts.
  useEffect(() => {
    const onFocus = () => {
      void load(null, false);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function handleCopy(link: LinkSummary) {
    if (await copyText(link.shortUrl)) {
      setCopiedCode(link.code);
      setTimeout(() => setCopiedCode(null), 1400);
    }
  }

  return (
    <>
      <div className="section-head">
        <h2>All links</h2>
        <span className="list-meta mono muted">
          {loading && links.length === 0 ? "loading…" : `${total} total`}
          <button
            className="icon-btn"
            onClick={() => void load(null, false)}
            aria-label="Refresh list"
            title="Refresh"
          >
            <RefreshIcon />
          </button>
        </span>
      </div>

      {error && <p className="error-line">{error}</p>}

      {loading && links.length === 0 && !error && <div className="skeleton list-block" />}

      {!loading && !error && links.length === 0 && (
        <p className="empty">Nothing here yet — shorten a link above and it shows up in this list.</p>
      )}

      {links.length > 0 && (
        <ul className="recents">
          {links.map((l, i) => (
            <li key={l.code} className="recent-row" style={{ "--index": i % PAGE_SIZE } as CSSProperties}>
              <span className="row-code">/{l.code}</span>
              <span className="row-url" title={l.originalUrl}>
                {truncateMiddle(l.originalUrl, 48)}
              </span>
              <span className="row-meta" title={new Date(l.createdAt).toLocaleString()}>
                {l.clicks.toLocaleString()} {l.clicks === 1 ? "click" : "clicks"} ·{" "}
                {l.expiresAt ? formatExpiry(l.expiresAt) : timeAgo(l.createdAt)}
              </span>
              <span className="row-actions">
                <button className="icon-btn" onClick={() => handleCopy(l)} aria-label="Copy short link">
                  {copiedCode === l.code ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button className="icon-btn" onClick={() => onStats(l.code)} aria-label="View stats">
                  <ChartIcon />
                </button>
                <a
                  className="icon-btn"
                  href={l.shortUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open short link"
                >
                  <ExternalIcon />
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      {cursor !== null && (
        <div className="list-footer">
          <button className="btn-ghost" onClick={() => void load(cursor, true)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
