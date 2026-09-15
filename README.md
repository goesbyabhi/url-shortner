# snip — a URL shortener built as a system design study

A working URL shortener with the features interviewers actually ask about: short-code
generation, a cache-aside read path, custom aliases, link expiry, async click analytics,
and rate limiting — plus a UI and a document explaining every tradeoff.

**Stack:** Express (TypeScript) · PostgreSQL · Redis · React (Vite, TypeScript)

The same domain logic runs on two runtimes: a **Node/Express server** with Redis, and a
**Cloudflare Workers port** (Hono + Hyperdrive + Durable Objects) — see
[the Workers port](#cloudflare-workers-port). Both are exercised by the same e2e suite in CI.

[![CI](https://github.com/goesbyabhi/url-shortner/actions/workflows/ci.yml/badge.svg)](https://github.com/goesbyabhi/url-shortner/actions/workflows/ci.yml)

---

## Quickstart

Requirements: Node 20+, Docker.

```bash
docker compose up -d      # postgres + redis
npm install               # installs all four workspaces
```

Either runtime serves the same SPA against the same database — pick one:

```bash
npm run dev               # Node/Express + Redis  → api :3000, web :5173
npm run dev:workers       # Cloudflare Workers    → everything on :8787
```

Open the web origin (`http://localhost:5173` for Express, `http://localhost:8787` for
Workers). Short URLs resolve at `<origin>/:code`.

```bash
npm test                  # shared unit tests (base62, validation)
npm run typecheck         # all four workspaces
bash scripts/e2e.sh <url> # end-to-end suite against a running api (curl + jq)
```

CI (`.github/workflows/ci.yml`) runs four jobs on every push/PR: **unit tests +
typecheck + client build**, **two end-to-end jobs** that boot each runtime against
real Postgres (plus Redis for Express) and assert the full lifecycle
(shorten → 302s → stats → 409 → 410 → 400 → 404 → 429), and a **docker job** that
proves both production images build.

---

## API

| Method | Path                  | Body / Params                                    | Success | Errors |
| ------ | --------------------- | ------------------------------------------------ | ------- | ------ |
| POST   | `/api/shorten`        | `{url, customAlias?, expiresInSeconds?}`         | `201`   | `400` invalid input, `409` alias taken, `429` rate limited |
| GET    | `/:code`              | —                                                | `302` redirect | `404` unknown, `410` expired |
| GET    | `/api/stats/:code`    | —                                                | `200`   | `404` |
| GET    | `/api/links`          | `?limit=20&cursor=`                              | `200`   | `400` bad cursor |
| DELETE | `/api/links/:code`    | —                                                | `204`   | `404` |
| GET    | `/api/health`         | —                                                | `200`   | `503` |

Rate limiting applies only to `POST /api/shorten` — **30 requests / 60s / IP**,
enforced by a Redis fixed-window counter. Responses carry `X-RateLimit-*` headers;
`429`s carry `Retry-After`.

---

## Architecture

```mermaid
flowchart LR
    B["Browser<br/>React SPA"] -->|"POST /api/shorten"| RL["Rate limit<br/>(Redis counter)"]
    B -->|"GET /:code"| R["Express API"]
    R -->|1. cache read| C[("Redis<br/>url:{code}")]
    R -->|2. miss → lookup| P[("Postgres<br/>links, click_events")]
    R -->|3. populate cache| C
    R -.->|fire-and-forget click event| P
    R -->|302| B
    W["Expiry sweep<br/>(every 5 min)"] --> P
    B -->|"GET /api/stats/:code"| R
```

### The read path (cache-aside)

1. `GET /:code` checks Redis first (`url:{code}`). Most traffic ends here.
2. On a miss, Postgres is queried and the entry is written back to Redis.
3. Redirects are `302`, not `301` — browsers re-check on every click, so
   analytics stay accurate and changes to a link propagate instantly.

Cache TTL is the link's **remaining lifetime** (capped at 24h), so an expired
link can never be served from cache. Cache reads fail open: if Redis is down,
traffic falls through to Postgres.

### The write path (analytics)

Clicks are recorded **fire-and-forget** after the redirect decision — an insert
into `click_events` plus an increment of a denormalized `links.click_count`.
The redirect never waits on analytics and never fails because of it.

At scale this write path would graduate to: Redis-buffered batches → Kafka →
a rollup table. The demo keeps it simple and points at the escape hatch.

### Expiry

Two mechanisms, both cheap:

- **Lazy delete** — an expired link found during a redirect is deleted
  immediately (events cascade) and returns `410`.
- **Periodic sweep** — every 5 minutes a job removes expired rows so lookups
  and stats stay clean even for links nobody visits.

---

## Design decisions

### 1. Short-code generation

**Choice: random 7-char base62 with collision retry.**

62^7 ≈ 3.5 trillion codes. Random codes are generated with
`crypto.randomBytes` (rejection-sampled to avoid modulo bias) and inserted
under a unique constraint — a collision simply retries (at most 3 attempts).

| Alternative | Pros | Cons |
| --- | --- | --- |
| **Counter + base62** (`encode(id)`) | zero collisions, trivially correct | sequential codes expose volume and are guessable |
| **Pregenerated key pool** (KGS) | no retry loop at write time | extra infra; keys can leak/queue backpressure |

Random generation keeps the API stateless and needs no coordination between
instances. The unique index is the single source of truth.

### 2. Why 302 over 301

`301` is cached permanently by browsers — subsequent clicks never reach the
server, killing analytics and making a URL un-changeable. `302` keeps every
click observable at the cost of one extra round trip.

### 3. Rate limiting — fixed window

`INCR rl:{ip}:{windowIndex}` + `EXPIRE` = two O(1) Redis ops per request.

| Alternative | Property |
| --- | --- |
| Fixed window (chosen) | simplest; boundary burst of up to 2× the limit |
| Sliding window log | exact; O(n) memory per IP |
| Token bucket | smooth; allows controlled bursts |

The limiter **fails open** — if Redis is unavailable, requests proceed.
For an abuse-sensitive product that choice might flip to fail-closed.

### 4. Data model

```sql
links (id, code UNIQUE, original_url, is_custom,
       expires_at, click_count, created_at)
click_events (id, code → links.code ON DELETE CASCADE,
              referrer, user_agent, clicked_at)
```

`click_count` is denormalized so the total is one row read, not a count over
events. Indices: `(expires_at)` partial, `(code, clicked_at DESC)` for the
per-day and referrer aggregations.

### 5. Reclaiming memory from unknown codes

An attacker hammering random codes misses cache and Postgres every time
(cache penetration). The standard answer is a **bloom filter** of live codes
in front of the cache — not needed at demo scale, but it is the natural
next hardening step.

### 6. Listing links — and the one design smell

`GET /api/links` returns every link, newest first. Two decisions worth defending:

- **Keyset (cursor) pagination over the `bigserial id`, not `OFFSET`.** The cursor is the
  last seen id (`WHERE id < $cursor ORDER BY id DESC LIMIT n+1`). New links can be inserted
  between pages without shifting rows into or out of the next page, and page cost stays flat
  instead of scanning-and-discarding `OFFSET` rows.
- **Fetch `limit + 1` rows** to detect whether another page exists without a second query,
  and **count the total only on the first page** — an unconditional `COUNT(*)` per page is an
  O(n) scan on every request, trivial to abuse.

**The smell:** the endpoint is unauthenticated, so anyone can enumerate every link ever
created — a privacy and abuse problem, not a feature. At this scale it's a demo convenience
(page size capped at 50, link metadata only, no click data). A real product must scope the
query to the caller — an account id or API key on the `WHERE` clause — and nothing else
about this design changes when you add that.

Related smaller tradeoffs:

- **Delete exists (`DELETE /api/links/:code`) and is the sharpest example of the auth
  problem** — until it's account-scoped, anyone can destroy anyone else's link. One
  implementation detail is not optional: deleting must invalidate the cache as well, or the
  short code keeps redirecting until its TTL expires.
- **Shortening the same URL twice creates two links.** Deliberate: it keeps `POST /api/shorten`
  idempotent-free and stateless. A "return the existing code for an identical URL" lookup is
  the alternative, at the cost of a hot-row lookup per write.
- **Rate limiting covers writes only** (`POST /api/shorten`). Reads — redirects, stats, the
  listing — are unmetered, which is the right default for a read-heavy shortener but does
  leave the listing open to scraping. Account scoping (above) is the real fix.

---

## Capacity estimation (back-of-envelope)

Assumptions: 100M new links/month, 100:1 read:write (typical for shorteners).

- Writes: 100M / 31d / 86.4k s ≈ **40 writes/s** (avg), ~5× peak ≈ 200/s
- Reads: 100 × writes ≈ **4,000 reads/s** avg, ~20k/s peak
- Storage: 100M × ~500 B/link incl. events ≈ **50 GB/mo** → shard long before
  a single Postgres box hurts
- Cache: hot links follow a power law; a 10M-entry Redis (~1 GB) can serve
  the overwhelming majority of reads

The read-heavy ratio is why the design invests in the cache path and keeps
writes minimal (one insert, no synchronous analytics).

---

## Scaling path

1. **Stateless API** — Express holds no session state; scale horizontally
   behind a load balancer.
2. **Read replicas** — redirects are reads; replicate Postgres and let the
   cache absorb misses.
3. **Shard by code** — hash the short code to a shard; a redirect touches
   exactly one shard. No cross-shard joins exist in the hot path.
4. **Swap Postgres for a KV store** (DynamoDB/RocksDB) once link rows stop
   needing relational features; the schema is already key-shaped.
5. **Analytics pipeline** — move `recordClickAsync` to Kafka + worker +
   rollup tables; stats queries then never touch the serving database.
6. **CDN** for the SPA; the API itself stays dynamic for 302s.

---

## Cloudflare Workers port

The `workers/` workspace is the same application — identical routes, status codes, response
shapes, and SQL — rewritten for Cloudflare's runtime. Both runtimes run the *same* e2e suite
in CI, so their behavior stays in lockstep.

| Concern | `server/` (Node) | `workers/` (Cloudflare) |
| --- | --- | --- |
| HTTP framework | Express | Hono |
| Postgres | `pg` pool | `pg` over **Hyperdrive** (pooled, query-cached) |
| Link cache | Redis (`url:{code}`, one region) | **Cache API** (per data center, synthetic key) |
| Rate limiting | Redis `INCR` fixed window | **Durable Object** — strongly consistent per-IP counter, alarm cleanup |
| Analytics | un-awaited insert | `ctx.waitUntil()` — guaranteed post-response |
| Expiry sweep | `setInterval` | **Cron Trigger** (`*/5 * * * *`) + `scheduled` handler |
| SPA delivery | nginx container | **Workers Static Assets** (one Worker serves SPA + API + redirects) |
| Short URL origin | `BASE_URL` env | the request's origin — workers.dev, custom domain, previews all work |

Notable design points:

- **The edge cache replaces Redis, not the redirect.** Clicks must stay observable, so the
  302 is never cached; only the *link record* is cached under a synthetic key
  (`cache.snip.internal/link/{code}`) with `s-maxage` set to the link's remaining lifetime,
  so an expired link can never be served from cache.
- **KV would be the obvious rate-limit store and the wrong one** — eventually consistent and
  capped at ~1k writes/day on the free plan. A Durable Object gives one single-threaded
  counter per IP, with an alarm that clears storage when the window closes (one write per
  window, not per request).
- **`run_worker_first = ["/*", "!/assets/*"]`** — hashed assets skip the Worker entirely
  (edge-served, free); everything else invokes it, and non-API, non-code paths are delegated
  to the assets binding for SPA fallback.
- **Shared domain core.** `shared/` owns base62, validation and migrations; the Express
  server imports it, the Worker imports it, and the unit tests cover both.

### Free-tier limits

| Service | Free allowance |
| --- | --- |
| Workers | 100k requests/day, 10 ms CPU per request |
| Hyperdrive | 100k queries/day |
| Durable Objects (SQLite) | 100k requests/day, 13k GB-s/day |
| Static Assets | free, unmetered requests |
| Cron Triggers | free |

### Local development

```bash
docker compose up -d          # Postgres (the Worker reuses it; no Redis needed)
npm run migrate -w server     # apply the shared migrations
npm run dev:workers           # builds shared + client, then wrangler dev on :8787
```

`wrangler dev` runs the real workerd runtime with local Durable Object and Cache API
emulation, pointed at docker Postgres through Hyperdrive's `localConnectionString` — no
Cloudflare account needed. `npm run build -w workers` validates the bundle with a dry-run
deploy (also account-free).

### Deploy

```bash
npx wrangler login
npx wrangler hyperdrive create snip-hd --connection-string="postgres://<neon-url>"
# paste the printed id into workers/wrangler.jsonc, replacing REPLACE_WITH_HYPERDRIVE_ID

npm run migrate -w server     # PGHOST/PGUSER/… PGSSL=true pointed at Neon
npm run deploy:workers        # builds shared + client, then wrangler deploy
```

Live at `https://snip-worker.<your-subdomain>.workers.dev` — $0 on the free tier, and no
second host to pay for. Add a custom domain in the dashboard to drop the workers.dev origin
from the short URLs it stamps.

---

## Deploy

The repo ships a production stack: `compose.prod.yml` builds two images
(server → Node, client → nginx serving the SPA and proxying `/api` and
short codes to the API) plus Postgres and Redis with health-gated startup.
Migrations run automatically when the API boots.

**Local rehearsal** (same images a VPS would run):

```powershell
powershell -File scripts\deploy.ps1        # builds, starts on http://localhost:8080
powershell -File scripts\deploy.ps1 -Down  # stops it
```

**On a VPS** (Hetzner / DigitalOcean / EC2 — any host with Docker):

```bash
# once: provision a VM, install Docker, add your SSH key
git clone <your-repo> && cd url-shortner
BASE_URL=https://snip.example.com ./scripts/deploy.sh
```

Then:

1. **DNS** — point an `A`/`AAAA` record at the VM's IP.
2. **TLS** — either run Caddy/nginx on ports 80/443 in front (change
   `WEB_PORT` to bind only to the host, or drop `ports` entirely and let
   the edge proxy reach the container via the docker network), or put a
   cloud load balancer in front and terminate TLS there.
3. **`BASE_URL` must be the public https origin** — it is what the API
   stamps into every short URL it returns.
4. **Secrets** — before real traffic, replace the demo `shortener`
   Postgres credentials with real ones (env or Docker secrets), and set
   `RATE_LIMIT_MAX` to taste.

**Managed platforms** (Railway, Fly.io, Render): deploy `server/Dockerfile`
as the web service, attach managed Postgres + Redis, and set the same env
vars the compose file sets. Serve the client from any static host and
proxy `/api` + short codes to the service, or put nginx in front as
`compose.prod.yml` does.

### Free-tier cloud (no VPS)

Fully free, credit-card-less deployment: **Render** (API) + **Neon**
(Postgres) + **Upstash** (Redis) + **Cloudflare Pages** (SPA). The only
app changes needed are env vars — `PGSSL=true` for Neon's TLS,
`CORS_ORIGIN` set to your Pages domain, `VITE_API_URL` baked into the SPA
build, and `BASE_URL` as the public API origin (it stamps short URLs).

1. **Neon** — create a project, copy the connection params into the
   Render env vars (`PGSSL=true`).
2. **Upstash** — create a database, copy the `rediss://…` URL into
   `REDIS_URL`.
3. **Render** — New → Blueprint → pick this repo. `render.yaml` defines
   the service; set the `sync: false` values after the first deploy.
   Free services sleep after ~15 min idle — the first request pays a
   ~30-60s cold start. Short URLs resolve on the API origin
   (`https://snip-api.onrender.com/abc1234`).
4. **Cloudflare Pages** — build the SPA with the API origin baked in:

   ```bash
   VITE_API_URL=https://snip-api.onrender.com npm run build -w client
   npx wrangler pages deploy client/dist --project-name snip
   ```

   Then set Render's `CORS_ORIGIN` to the returned `*.pages.dev` origin.

**Why not all-Cloudflare?** Workers can't run this Express app as-is —
`pg` would need [Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
and `ioredis` has no Workers-compatible transport (you'd use Workers KV
or Durable Objects for cache + rate limiting instead). That's a rewrite
of `server/src` to something like Hono — same design, different runtime —
and a fine stretch goal, but not a config change.

---

## Project layout

```
url-shortner/
├─ shared/              # domain core both runtimes import
│  ├─ src/              # base62 codec, URL/alias validation (+ unit tests)
│  └─ migrations/       # SQL migrations — single source of truth
├─ server/              # Express + TypeScript API
│  ├─ Dockerfile        # multi-stage: build → slim production image
│  └─ src/
│     ├─ lib/           # redis cache, rate limit, analytics (runtime-specific)
│     ├─ routes/        # shorten, redirect (hot path), stats
│     ├─ db/            # pg pool, migration runner + CLI, link queries
│     └─ redis/         # ioredis client
├─ workers/             # Cloudflare Workers port
│  ├─ wrangler.jsonc    # assets, Durable Object, Hyperdrive, cron
│  └─ src/
│     ├─ lib/           # edge cache, DO rate limit, waitUntil analytics
│     ├─ routes/        # same routes as server, on Hono
│     ├─ ratelimit-do.ts
│     └─ index.ts       # fetch + scheduled handlers
├─ client/              # Vite + React SPA (Geist, dark minimal UI) — shared by both
│  ├─ Dockerfile        # build → nginx (SPA + reverse proxy)
│  ├─ nginx.conf        # serves the SPA, proxies /api and /:code
│  └─ src/components/   # form, result, links list (paginated), stats chart
├─ scripts/             # deploy.ps1 / deploy.sh, e2e.sh, e2e.ps1
├─ render.yaml           # free-tier cloud blueprint (Render)
├─ compose.prod.yml     # postgres + redis + api + nginx, health-gated
└─ docker-compose.yml   # dev infra only (postgres + redis)
```

The link list is **server-backed** (`GET /api/links`, newest first, keyset paginated),
so every shortened link is visible from any browser. There are no user accounts, which
makes that endpoint the one genuine design smell in the project — see design decision #6.

---

## Verification

- `npm run typecheck` passes for all four workspaces; `npm test` covers the shared domain core
- The e2e suite (`scripts/e2e.sh` in CI, `scripts/e2e.ps1` on Windows) runs against **both
  runtimes** and exercises: shorten → redirect ×2 (cache hit) → stats (3 clicks recorded) →
  custom alias (201) → duplicate alias (409) → alias redirect →
  2s-expiry link (302 → `410` after deadline, row swept) → invalid URL (400) →
  unknown code (404) → 40 rapid requests (rate limiter trips with `429`)
- Both runtimes were verified locally end-to-end (Express on `:3000`, Workers on `:8787`)
  and run as separate CI jobs on every push
- The production images build cleanly in CI, and the Node stack was verified through nginx
  in the full production compose stack

Every number in this README is either a default in `server/src/config.ts` /
`workers/wrangler.jsonc` or derived in the code — the code is the source of truth.
