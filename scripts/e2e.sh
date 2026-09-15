#!/usr/bin/env bash
# end-to-end suite against a running api (requires curl + jq)
# usage: scripts/e2e.sh [baseUrl]     default: http://localhost:3000
set -uo pipefail
base="${1:-http://localhost:3000}"
fail=0

check() {
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi
}

post() {
  curl -s -X POST "$base/api/shorten" -H 'Content-Type: application/json' -d "$1"
}

# --- 1. shorten a url -------------------------------------------------------
resp=$(post '{"url":"https://example.com/very/long/path?a=1","expiresInSeconds":3600}')
code=$(echo "$resp" | jq -r '.code')
short=$(echo "$resp" | jq -r '.shortUrl')
rc=1; [[ "$code" =~ ^[0-9a-zA-Z]{7}$ ]] && rc=0
check "shorten returns code ($code)" "$rc"
rc=1; [ "$short" = "$base/$code" ] && rc=0
check "shorten returns shortUrl ($short)" "$rc"

# --- 2. redirect twice (second is a cache hit) + Location header ------------
s1=$(curl -s -o /dev/null -w '%{http_code}' "$base/$code")
s2=$(curl -s -o /dev/null -w '%{http_code}' "$base/$code")
loc=$(curl -s -D - -o /dev/null "$base/$code" | tr -d '\r' | awk -F': ' 'tolower($1)=="location" {print $2}')
rc=1
{ [ "$s1" = "302" ] && [ "$s2" = "302" ] && [ "$loc" = "https://example.com/very/long/path?a=1" ]; } && rc=0
check "redirect 302 x2 with Location header" "$rc"

# --- 3. stats after the async analytics write settles -----------------------
sleep 1.2
total=$(curl -s "$base/api/stats/$code" | jq -r '.totalClicks')
rc=1; [ "$total" -eq 3 ] && rc=0
check "stats counted 3 clicks (got $total)" "$rc"

# --- 4. custom alias + conflict ----------------------------------------------
alias="my-repo-$(date +%s)"
st=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/shorten" \
  -H 'Content-Type: application/json' -d "{\"url\":\"https://github.com/torvalds\",\"customAlias\":\"$alias\"}")
rc=1; [ "$st" = "201" ] && rc=0
check "custom alias created ($alias)" "$rc"
dup=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/shorten" \
  -H 'Content-Type: application/json' -d "{\"url\":\"https://github.com\",\"customAlias\":\"$alias\"}")
rc=1; [ "$dup" = "409" ] && rc=0
check "duplicate alias rejected 409" "$rc"
al=$(curl -s -o /dev/null -w '%{http_code}' "$base/$alias")
rc=1; [ "$al" = "302" ] && rc=0
check "alias redirect works" "$rc"

# --- 5. expiry: 2s ttl --------------------------------------------------------
expcode=$(post '{"url":"https://example.com/short-lived","expiresInSeconds":2}' | jq -r '.code')
alive=$(curl -s -o /dev/null -w '%{http_code}' "$base/$expcode")
sleep 3
dead=$(curl -s -o /dev/null -w '%{http_code}' "$base/$expcode")
st404=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/stats/$expcode")
rc=1
{ [ "$alive" = "302" ] && [ "$dead" = "410" ] && [ "$st404" = "404" ]; } && rc=0
check "expired link 302 -> 410, row swept" "$rc"

# --- 6. invalid url -----------------------------------------------------------
bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/shorten" \
  -H 'Content-Type: application/json' -d '{"url":"ftp://example.com"}')
rc=1; [ "$bad" = "400" ] && rc=0
check "invalid url rejected 400" "$rc"

# --- 7. unknown code ----------------------------------------------------------
miss=$(curl -s -o /dev/null -w '%{http_code}' "$base/zzzzzzz")
rc=1; [ "$miss" = "404" ] && rc=0
check "unknown code 404" "$rc"

# --- 8. rate limiter ----------------------------------------------------------
seen=0
for i in $(seq 1 40); do
  st=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/shorten" \
    -H 'Content-Type: application/json' -d '{"url":"https://example.com/rate-test"}')
  [ "$st" = "429" ] && seen=$((seen + 1))
done
rc=1; [ "$seen" -gt 0 ] && rc=0
check "rate limiter trips (429 seen x$seen)" "$rc"

# --- 9. link listing + keyset pagination --------------------------------------
listing=$(curl -s "$base/api/links?limit=5")
listed=$(echo "$listing" | jq -r '.links | length')
total=$(echo "$listing" | jq -r '.total')
first_code=$(echo "$listing" | jq -r '.links[0].code')
rc=1; { [ "$listed" -ge 1 ] && [ "$listed" -le 5 ] && [ "$total" -ge "$listed" ]; } && rc=0
check "GET /api/links returns a page (n=$listed of $total)" "$rc"
rc=1; [ -n "$first_code" ] && [ "$first_code" != "null" ] && rc=0
check "newest link is first ($first_code)" "$rc"

cursor=$(echo "$listing" | jq -r '.nextCursor')
if [ "$cursor" != "null" ]; then
  page2=$(curl -s "$base/api/links?limit=5&cursor=$cursor" | jq -r '.links | length')
  rc=1; [ "$page2" -ge 1 ] && rc=0
  check "cursor pagination returns the next page (n=$page2)" "$rc"
  overlap=$(curl -s "$base/api/links?limit=5&cursor=$cursor" | jq -r --arg c "$first_code" '[.links[].code | select(. == $c)] | length')
  rc=1; [ "$overlap" -eq 0 ] && rc=0
  check "pages do not overlap" "$rc"
fi

bad_cursor=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/links?cursor=abc")
rc=1; [ "$bad_cursor" = "400" ] && rc=0
check "invalid cursor rejected 400" "$rc"

echo ""
if [ "$fail" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "ONE OR MORE CHECKS FAILED"
  exit 1
fi
