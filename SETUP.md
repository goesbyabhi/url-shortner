# SETUP — deploying the Cloudflare Workers port

Step-by-step guide to get this app live on Cloudflare's free tier. No VPS, no card.

**What you end up with:** one Worker serving the SPA, the API, and short-code redirects at
`https://snip-worker.<your-subdomain>.workers.dev`, backed by Postgres (Neon or any managed
Postgres) — no Redis, no containers, $0.

**What it costs:** nothing, within the free allowances.

| Service | Free allowance | Used by |
| --- | --- | --- |
| Workers | 100k requests/day, 10 ms CPU/request | API + redirects |
| Workers Static Assets | free, unmetered | the SPA |
| Hyperdrive | 100k queries/day | Postgres access |
| Durable Objects (SQLite) | 100k requests/day, 13k GB-s/day | rate limiting |
| Cron Triggers | free | expiry sweep |
| Postgres (Neon free tier) | 0.5 GB storage | the data |

Everything below is run from the **repo root** unless stated otherwise.

---

## 0. Prerequisites

- Node 20+ and npm
- A Cloudflare account (free): https://dash.cloudflare.com/sign-up
- A Postgres database. **Neon** free tier is the recommended pairing
  (https://neon.tech — sign up, "Create project").
- The repo checked out on the `cloudflare-workers` branch:

```powershell
git clone https://github.com/goesbyabhi/url-shortner.git
cd url-shortner
git checkout cloudflare-workers
npm install
```

---

## 1. Get your Postgres connection details

From the Neon dashboard, open your project → **Connection string** → copy the
`postgresql://…` URL. It looks like:

```
postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Split it into these pieces — you'll need both forms:

| Piece | Value from the example |
| --- | --- |
| host | `ep-cool-name-123456.us-east-2.aws.neon.tech` |
| port | `5432` |
| user | `neondb_owner` |
| password | `npg_XXXXXXXX` |
| database | `neondb` |

> Any managed Postgres works (Supabase, RDS, Railway…). It just needs to be reachable
> from Cloudflare and use TLS.

---

## 2. Apply the schema

The migrations live in `shared/migrations/`; the `server` workspace ships the migrator CLI.

**PowerShell:**

```powershell
$env:PGHOST="ep-cool-name-123456.us-east-2.aws.neon.tech"
$env:PGPORT="5432"
$env:PGUSER="neondb_owner"
$env:PGPASSWORD="npg_XXXXXXXX"
$env:PGDATABASE="neondb"
$env:PGSSL="true"
npm run migrate -w server
```

**bash/zsh:**

```bash
PGHOST=ep-cool-name-123456.us-east-2.aws.neon.tech \
PGPORT=5432 PGUSER=neondb_owner PGPASSWORD=npg_XXXXXXXX PGDATABASE=neondb PGSSL=true \
npm run migrate -w server
```

Expected output: `migrations applied: 001_init.sql` (or `migrations up to date`).

> `PGSSL=true` is required for hosted Postgres — `node-postgres` ignores `?sslmode=require`
> in the URL, so the migrator needs this flag to enable TLS.

---

## 3. Log in to Cloudflare

```bash
npx wrangler login
```

A browser opens; approve the OAuth prompt. If you've never used Workers, Cloudflare asks
you to pick your `workers.dev` subdomain (that's the `<your-subdomain>` in the URL).

Check it worked:

```bash
npx wrangler whoami
```

---

## 4. Create the Hyperdrive config

Hyperdrive gives the Worker pooled, query-cached Postgres access (required — a Worker can't
open a raw TCP connection to your database on its own).

```bash
npx wrangler hyperdrive create snip-hd --connection-string="postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb"
```

It prints something like:

```
{
  "id": "0123456789abcdef0123456789abcdef",
  ...
}
```

**Copy that `id`** and paste it into `workers/wrangler.jsonc`, replacing the placeholder:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "0123456789abcdef0123456789abcdef",   // ← your real id
    "localConnectionString": "postgres://shortener:shortener@localhost:5432/shortener"
  }
],
```

`localConnectionString` is only used by `wrangler dev` on your machine — leave it as is.
(You can always find the id later with `npx wrangler hyperdrive list`.)

> If your database password contains characters like `@`, `#`, `?` or `/`, URL-encode them
> in the connection string (e.g. `@` → `%40`) before passing it to `wrangler`.

---

## 5. Deploy

```bash
npm run deploy:workers
```

That script builds the shared workspace, builds the SPA with same-origin API calls
(correct for the Worker — do **not** set `VITE_API_URL` here), and runs `wrangler deploy`.

Expected output ends with:

```
Uploaded snip-worker (…)
Deployed snip-worker triggers (…)
  https://snip-worker.<your-subdomain>.workers.dev
  schedule: */5 * * * *
```

---

## 6. Verify

**PowerShell** (replace the host):

```powershell
$base = "https://snip-worker.<your-subdomain>.workers.dev"

# 1. health — expect {"status":"ok","pg":true} (public)
curl.exe -s "$base/api/health"

# 2. get an API key — the token prints once; keep it for the calls below
$token = (curl.exe -s -X POST "$base/api/keys" | ConvertFrom-Json).token
$auth = "Authorization: Bearer $token"

# 3. shorten — expect 201 + JSON with a 7-char code and a shortUrl on $base
curl.exe -s -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/hello\"}'

# 4. redirect — expect 302 and a Location header (public; run the GET, do not follow)
curl.exe -s -D - -o NUL "$base/<code-from-step-3>"

# 5. your links — expect the link from step 3 (only your key sees it)
curl.exe -s -H $auth "$base/api/links"

# 6. stats — expect totalClicks to have incremented
curl.exe -s -H $auth "$base/api/stats/<code-from-step-3>"
```

Then open the root URL in a browser — the SPA should load, and shortening from the UI should
work end to end.

> **Auth:** shortening, listing, stats and delete all require `Authorization: Bearer <token>`.
> The app mints an anonymous key on first use and keeps it in your browser's localStorage
> under `snip:api_key`; only its SHA-256 hash is stored server-side. Redirects are public — a
> short link is shareable — so opening `$base/<code>` needs no key. See design decision #7 in
> [README.md](./README.md).

**bash:**

```bash
base="https://snip-worker.<your-subdomain>.workers.dev"
token=$(curl -s -X POST "$base/api/keys" | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s "$base/api/health"
curl -s -X POST "$base/api/shorten" -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' -d '{"url":"https://example.com/hello"}'
curl -s -H "Authorization: Bearer $token" "$base/api/links"
```

### Full automated check (optional)

`scripts/e2e.sh` (needs `curl` + `jq`) or `scripts/e2e.ps1` (PowerShell) run the whole
lifecycle against a live origin:

```powershell
powershell -File scripts\e2e.ps1 -BaseUrl "https://snip-worker.<your-subdomain>.workers.dev"
```

Expected: 31 `PASS` lines and `ALL CHECKS PASSED`.

> The rate-limiter checks fire ~45 requests in a minute by design. If you run the suite and
> then use the UI immediately, shorten may return `429` until the 60-second window rolls over.

---

## 7. Custom domain (optional)

Short links are stamped with whatever origin the request arrives on, so both work:

1. Cloudflare dashboard → **Workers & Scripts** → `snip-worker` → **Settings** →
   **Domains & Routes** → **Add** → **Custom Domain** → e.g. `snip.yourdomain.com`
2. The domain's DNS zone must be in the **same** Cloudflare account; the record is created
   for you and the certificate is issued automatically.
3. Deploy again only if you also want to change the Worker name:

```jsonc
// workers/wrangler.jsonc
"name": "snip",           // → snip.<your-subdomain>.workers.dev
```

Once the custom domain is live, short URLs will look like
`https://snip.yourdomain.com/abc1234`. Optionally disable the `workers.dev` route in
Settings → Domains & Routes so only the custom domain is reachable.

---

## Redeploying after code changes

```bash
git pull
npm install                 # only if dependencies changed
npm run deploy:workers
```

Schema changes: add a new `.sql` file to `shared/migrations/` and re-run step 2. The
migrator tracks applied files in `schema_migrations`, so it's safe to run repeatedly.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `"hyperdrive[0]" bindings must have a "id" field` | The placeholder is still in `workers/wrangler.jsonc` — complete step 4. |
| `/api/health` returns `{"status":"ok","pg":false}` | Worker can't reach Postgres. Check the Hyperdrive connection string, then `npx wrangler hyperdrive update <id> --connection-string="…"`. |
| Health is `pg:false` but Hyperdrive is fine | Schema not applied — re-run step 2 against the same database. |
| `password authentication failed` during migrate | Wrong `PG*` values, or missing `PGSSL=true`. |
| `client password must be a string` / auth error on `hyperdrive create` | Special characters in the password — URL-encode them (`@` → `%40`, `#` → `%23`). |
| `429` on the first shorten | Rate limit is 30 requests / 60 s / IP. Wait a minute, or raise `RATE_LIMIT_MAX` in `workers/wrangler.jsonc` and redeploy. |
| SPA loads but API calls fail | You deployed with `VITE_API_URL` set, or the Worker name changed without redeploying the client. Re-run `npm run deploy:workers` with no `VITE_API_URL` in the environment. |
| `wrangler deploy` says the name is taken | Rename `name` in `workers/wrangler.jsonc` (workers.dev names are globally unique). |
| Local error `docker` / Postgres refused | Only relevant for local dev, not deployment. For local dev: `docker compose up -d` then `npm run dev:workers`. |

Logs for a live Worker:

```bash
npx wrangler tail -c workers/wrangler.jsonc
```

---

## Teardown (delete everything)

```bash
# from the workers/ directory
npx wrangler delete

# remove the Hyperdrive config — pass its id (find it with: npx wrangler hyperdrive list)
npx wrangler hyperdrive delete <id>
```

Then delete the database in the Neon dashboard. Nothing else was created — no paid
resources, no lingering VMs.

---

## How it maps to the repo

| Deployment artifact | File |
| --- | --- |
| Worker config (name, assets, DO, Hyperdrive, cron, vars) | `workers/wrangler.jsonc` |
| Worker entry (`fetch` + `scheduled`) | `workers/src/index.ts` |
| Rate limiter Durable Object | `workers/src/ratelimit-do.ts` |
| Schema (applied in step 2) | `shared/migrations/001_init.sql` |
| Deploy orchestration | `package.json` → `deploy:workers` |

Full design notes, the runtime mapping table, and the Node/Express + Redis variant live in
[README.md](./README.md).
