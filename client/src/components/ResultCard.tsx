import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalIcon } from "../lib/icons";
import { copyText, formatExpiry, truncateMiddle } from "../lib/format";
import type { ShortenResponse } from "../types";

export function ResultCard({ result }: { result: ShortenResponse }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyText(result.shortUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div className="result-card" role="status">
      <div className="result-top">
        <span className="result-url">{result.shortUrl}</span>
        <div className="result-actions">
          <button className="btn" onClick={handleCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            className="icon-btn"
            href={result.shortUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open short link"
          >
            <ExternalIcon />
          </a>
        </div>
      </div>
      <div className="result-meta">
        <span className="meta-url" title={result.originalUrl}>
          {truncateMiddle(result.originalUrl, 64)}
        </span>
        {result.expiresAt && <span className="tag tag-amber">{formatExpiry(result.expiresAt)}</span>}
      </div>
    </div>
  );
}
