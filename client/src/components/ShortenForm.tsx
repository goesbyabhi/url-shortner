import { useState, type FormEvent } from "react";
import { shorten } from "../api";
import { ChevronIcon } from "../lib/icons";
import type { ShortenResponse } from "../types";

const EXPIRY_OPTIONS = [
  { label: "Never", value: 0 },
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 604_800 },
  { label: "30 days", value: 2_592_000 },
];

export function ShortenForm({ onSuccess }: { onSuccess: (result: ShortenResponse) => void }) {
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiry, setExpiry] = useState(0);
  const [showOptions, setShowOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!url.trim()) {
      setError("paste a url first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await shorten({
        url,
        customAlias: alias.trim() || undefined,
        expiresInSeconds: expiry || undefined,
      });
      onSuccess(result);
      setUrl("");
      setAlias("");
      setExpiry(0);
      setShowOptions(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="shorten-form" onSubmit={handleSubmit}>
      <div className="input-row">
        <input
          className="field"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a long URL — example.com/very/long/path"
          autoComplete="off"
          spellCheck={false}
          aria-label="Long URL"
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Shortening…" : "Shorten"}
        </button>
      </div>

      <button
        type="button"
        className={`options-toggle ${showOptions ? "open" : ""}`}
        onClick={() => setShowOptions((v) => !v)}
        aria-expanded={showOptions}
      >
        <ChevronIcon className="chev" />
        Options — alias, expiry
      </button>

      {showOptions && (
        <div className="options">
          <input
            className="field"
            type="text"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="custom alias — e.g. portfolio"
            spellCheck={false}
            aria-label="Custom alias"
          />
          <select
            className="field"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
            aria-label="Expiry"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="error-line" role="alert">{error}</p>}
    </form>
  );
}
