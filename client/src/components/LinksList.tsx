import { Fragment, useCallback, useEffect, useState, type CSSProperties } from "react";
import { deleteLink, listLinks } from "../api";
import { ChartIcon, CheckIcon, CopyIcon, ExternalIcon, RefreshIcon, TrashIcon } from "../lib/icons";
import { copyText, formatExpiry, timeAgo, truncateMiddle } from "../lib/format";
import { StatsPanel } from "./StatsPanel";
import type { LinkSummary } from "../types";

const PAGE_SIZE = 20;

/**
 * Server-backed list of every shortened link, newest first.
 *
 * UX notes:
 * - stats expand inline under their own row (not in a section at the page
 *   bottom), so the panel is always visually attached to the link it describes
 * - delete is a two-step inline confirm, never a browser confirm() dialog
 * - the list refetches when the tab regains focus, because clicks happen in
 *   another tab
 */
export function LinksList({ refreshKey }: { refreshKey: number }) {
  const [links, setLinks] = useState<LinkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [openStats, setOpenStats] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  function toggleStats(code: string) {
    setConfirming(null);
    setOpenStats((current) => (current === code ? null : code));
  }

  async function handleDelete(link: LinkSummary) {
    setDeleting(link.code);
    setError(null);
    try {
      await deleteLink(link.code);
      setLinks((prev) => prev.filter((l) => l.code !== link.code));
      setTotal((t) => Math.max(0, t - 1));
      if (openStats === link.code) setOpenStats(null);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete link");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <div className="section-head">
        <h2>Your links</h2>
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
        <p className="empty">
          Nothing here yet. Links you shorten are tied to this browser's anonymous key, so they show up in this
          list and nowhere else.
        </p>
      )}

      {links.length > 0 && (
        <ul className="recents">
          {links.map((l, i) => (
            <Fragment key={l.code}>
              <li
                className={`recent-row ${openStats === l.code ? "open" : ""}`}
                style={{ "--index": i % PAGE_SIZE } as CSSProperties}
              >
                <span className="row-code">/{l.code}</span>
                <span className="row-url" title={l.originalUrl}>
                  {truncateMiddle(l.originalUrl, 48)}
                </span>
                <span className="row-meta" title={new Date(l.createdAt).toLocaleString()}>
                  {l.clicks.toLocaleString()} {l.clicks === 1 ? "click" : "clicks"} ·{" "}
                  {l.expiresAt ? formatExpiry(l.expiresAt) : timeAgo(l.createdAt)}
                </span>

                {confirming === l.code ? (
                  <span className="row-actions confirming">
                    <span className="confirm-text">Delete?</span>
                    <button
                      className="btn-mini danger"
                      onClick={() => void handleDelete(l)}
                      disabled={deleting === l.code}
                    >
                      {deleting === l.code ? "Deleting…" : "Delete"}
                    </button>
                    <button className="btn-mini" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="row-actions">
                    <button className="icon-btn" onClick={() => void handleCopy(l)} aria-label="Copy short link">
                      {copiedCode === l.code ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    <button
                      className={`icon-btn ${openStats === l.code ? "active" : ""}`}
                      onClick={() => toggleStats(l.code)}
                      aria-label="Toggle stats"
                      aria-expanded={openStats === l.code}
                      title="Stats"
                    >
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
                    <button
                      className="icon-btn danger"
                      onClick={() => {
                        setOpenStats(null);
                        setConfirming(l.code);
                      }}
                      aria-label="Delete link"
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </span>
                )}
              </li>

              {openStats === l.code && (
                <li className="stats-inline">
                  <StatsPanel code={l.code} onClose={() => setOpenStats(null)} />
                </li>
              )}
            </Fragment>
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
