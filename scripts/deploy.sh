#!/usr/bin/env bash
# deploys the full production stack: postgres, redis, api, nginx (web)
# usage:
#   ./scripts/deploy.sh                                   # local rehearsal on :8080
#   BASE_URL=https://snip.example.com ./scripts/deploy.sh
#   ./scripts/deploy.sh down                              # tear the stack down
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export BASE_URL="${BASE_URL:-http://localhost:8080}"

if [ "${1:-}" = "down" ]; then
  docker compose -f "$root/compose.prod.yml" down
  exit 0
fi

echo "==> building images…"
docker compose -f "$root/compose.prod.yml" build

echo "==> starting stack…"
docker compose -f "$root/compose.prod.yml" up -d
docker compose -f "$root/compose.prod.yml" ps

echo ""
echo "up at $BASE_URL"
echo "verify: $BASE_URL/api/health"
