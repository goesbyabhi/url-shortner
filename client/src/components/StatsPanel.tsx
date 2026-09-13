import { useEffect, useState } from "react";
import { getStats } from "../api";
import { CloseIcon } from "../lib/icons";
import { formatExpiry, referrerLabel, timeAgo, truncateMiddle } from "../lib/format";
import type { LinkStats } from "../types";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; stats: LinkStats };

const pad = (n: number) => String(n).padStart(2, "0");

/** Full 14-day range including zero-click days. */
function buildDays(byDay: { day: string; clicks: number }[]): { day: string; clicks: number }[] {
  const map = new Map(byDay.map((d) => [d.day, d.clicks]));
  const now = new Date();
  const out: { day: string; clicks: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out.push({ day: key, clicks: map.get(key) ?? 0 });
  }
  return out;
}

export function StatsPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    getStats(code)
      .then((stats) => {
        if (!cancelled) setState({ phase: "ready", stats });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ phase: "error", message: err instanceof Error ? err.message : "failed to load stats" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="stats-panel">
      <div className="stats-head">
        <span className="stats-code">/{code}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close stats">
          <CloseIcon />
        </button>
      </div>

      {state.phase === "loading" && (
        <div className="stats-loading">
          <div className="metrics">
            <div className="skeleton metric" />
            <div className="skeleton metric" />
            <div className="skeleton metric" />
          </div>
          <div className="skeleton chart-block" />
        </div>
      )}

      {state.phase === "error" && <p className="error-line">{state.message}</p>}

      {state.phase === "ready" && <StatsBody stats={state.stats} />}
    </div>
  );
}

function StatsBody({ stats }: { stats: LinkStats }) {
  const days = buildDays(stats.byDay);
  const max = Math.max(1, ...days.map((d) => d.clicks));

  return (
    <>
      <div className="metrics">
        <div className="metric">
          <p className="label">Total clicks</p>
          <p className="metric-value">{stats.totalClicks.toLocaleString()}</p>
          <p className="metric-sub">{stats.totalClicks === 0 ? "no clicks yet" : "all time"}</p>
        </div>
        <div className="metric">
          <p className="label">Created</p>
          <p className="metric-value">{timeAgo(stats.createdAt)}</p>
          <p className="metric-sub">{new Date(stats.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="metric">
          <p className="label">Expires</p>
          <p className="metric-value">
            {stats.expiresAt ? formatExpiry(stats.expiresAt) : "Never"}
          </p>
          <p className="metric-sub">
            {stats.expiresAt ? new Date(stats.expiresAt).toLocaleDateString() : "no deadline set"}
          </p>
        </div>
      </div>

      <p className="label">Clicks — last 14 days</p>
      <div className="chart" role="img" aria-label={`Clicks per day for the last 14 days, ${stats.totalClicks} total`}>
        {days.map((d) => (
          <div
            key={d.day}
            className={`bar ${d.clicks === 0 ? "zero" : ""}`}
            style={{ height: `${Math.max(2, (d.clicks / max) * 100)}%` }}
            title={`${d.day}: ${d.clicks} click${d.clicks === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <div className="chart-labels">
        {days.map((d, i) => (
          <span key={d.day} style={{ visibility: i % 2 === 0 || i === days.length - 1 ? "visible" : "hidden" }}>
            {d.day.slice(8)}
          </span>
        ))}
      </div>

      <div className="referrers">
        <p className="label">Top referrers</p>
        {stats.topReferrers.length === 0 ? (
          <p className="empty">No clicks recorded yet.</p>
        ) : (
          stats.topReferrers.map((r) => (
            <div className="ref-row" key={r.referrer}>
              <span className="ref-name">{referrerLabel(r.referrer)}</span>
              <span className="ref-count">{r.clicks.toLocaleString()}</span>
            </div>
          ))
        )}
      </div>

      <p className="stats-original" title={stats.originalUrl}>
        {truncateMiddle(stats.originalUrl, 72)}
      </p>
    </>
  );
}
