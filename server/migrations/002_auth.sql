-- Auth scoping: links belong to an API key, so listing/stats/delete can be
-- scoped to the caller instead of exposing every link to everyone.
--
-- Keys are anonymous (provisioned per browser on first use, no signup) but they
-- are real owned principals: only the SHA-256 hash of the token is stored.

CREATE TABLE IF NOT EXISTS api_keys (
  id         BIGSERIAL   PRIMARY KEY,
  token_hash TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nullable on purpose: rows created before auth existed have no owner. They keep
-- resolving (a short link is public by design) but are invisible to listings and
-- cannot be deleted through the API. A real migration would backfill or expire
-- them; this demo leaves them as read-only legacy links.
ALTER TABLE links
  ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES api_keys (id) ON DELETE CASCADE;

-- Exactly the shape the keyset listing needs: newest-first pages per owner.
CREATE INDEX IF NOT EXISTS idx_links_owner_id
  ON links (owner_id, id DESC);
