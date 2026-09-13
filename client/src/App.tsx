import { useState } from "react";
import { RecentLinks } from "./components/RecentLinks";
import { ResultCard } from "./components/ResultCard";
import { ShortenForm } from "./components/ShortenForm";
import { StatsPanel } from "./components/StatsPanel";
import { useRecents } from "./hooks/useRecents";
import type { ShortenResponse } from "./types";

export default function App() {
  const [result, setResult] = useState<ShortenResponse | null>(null);
  const [statsCode, setStatsCode] = useState<string | null>(null);
  const { recents, addRecent, removeRecent } = useRecents();

  function handleSuccess(r: ShortenResponse) {
    setResult(r);
    setStatsCode(null);
    addRecent({
      code: r.code,
      shortUrl: r.shortUrl,
      originalUrl: r.originalUrl,
      createdAt: new Date().toISOString(),
      expiresAt: r.expiresAt,
    });
  }

  return (
    <div className="app">
      <header className="site-header">
        <span className="wordmark">
          snip<span className="wordmark-dot">.</span>
        </span>
        <span className="tagline">URL shortener</span>
      </header>

      <main>
        <section className="hero">
          <p className="kicker">System design demo</p>
          <h1>Long links, made short.</h1>
          <p className="sub">
            Paste a URL, optionally give it an alias or a deadline, and every redirect gets counted.
          </p>
          <ShortenForm onSuccess={handleSuccess} />
          {result && <ResultCard result={result} />}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Recent</h2>
            <span className="mono muted">
              {recents.length}/10 · stored locally
            </span>
          </div>
          <RecentLinks items={recents} onStats={setStatsCode} onRemove={removeRecent} />
        </section>

        {statsCode && (
          <section className="section">
            <StatsPanel code={statsCode} onClose={() => setStatsCode(null)} />
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span className="mono">Express · Postgres · Redis · React</span>
        <span className="mono muted">cache-aside reads · async analytics · fixed-window rate limits — see README</span>
      </footer>
    </div>
  );
}
