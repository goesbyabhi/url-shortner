CREATE TABLE IF NOT EXISTS links (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE,
  original_url TEXT       NOT NULL,
  is_custom   BOOLEAN     NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ,
  click_count BIGINT      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_links_expires_at
  ON links (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS click_events (
  id         BIGSERIAL PRIMARY KEY,
  code       TEXT        NOT NULL REFERENCES links (code) ON DELETE CASCADE,
  referrer   TEXT,
  user_agent TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_click_events_code_time
  ON click_events (code, clicked_at DESC);
