import { useState, type CSSProperties } from "react";
import { ChartIcon, CheckIcon, CopyIcon, ExternalIcon, TrashIcon } from "../lib/icons";
import { copyText, formatExpiry, timeAgo, truncateMiddle } from "../lib/format";
import type { RecentLink } from "../types";

export function RecentLinks({
  items,
  onStats,
  onRemove,
}: {
  items: RecentLink[];
  onStats: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function handleCopy(text: string, code: string) {
    if (await copyText(text)) {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1400);
    }
  }

  if (items.length === 0) {
    return <p className="empty">Nothing here yet — shorten a link above and it shows up in this list.</p>;
  }

  return (
    <ul className="recents">
      {items.map((r, i) => (
        <li key={r.code} className="recent-row" style={{ "--index": i } as CSSProperties}>
          <span className="row-code">/{r.code}</span>
          <span className="row-url" title={r.originalUrl}>
            {truncateMiddle(r.originalUrl, 48)}
          </span>
          <span className="row-meta">
            {r.expiresAt ? formatExpiry(r.expiresAt) : timeAgo(r.createdAt)}
          </span>
          <span className="row-actions">
            <button
              className="icon-btn"
              onClick={() => handleCopy(r.shortUrl, r.code)}
              aria-label="Copy short link"
            >
              {copiedCode === r.code ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button className="icon-btn" onClick={() => onStats(r.code)} aria-label="View stats">
              <ChartIcon />
            </button>
            <a
              className="icon-btn"
              href={r.shortUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open short link"
            >
              <ExternalIcon />
            </a>
            <button className="icon-btn danger" onClick={() => onRemove(r.code)} aria-label="Remove from list">
              <TrashIcon />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
