# end-to-end suite against a running api (Windows-friendly mirror of scripts/e2e.sh)
# usage: powershell -File scripts\e2e.ps1 -BaseUrl http://localhost:3000
param([string]$BaseUrl = "http://localhost:3000")

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$fail = 0

function Check($name, $cond) {
  if ($cond) { Write-Output "PASS  $name" } else { Write-Output "FAIL  $name"; $script:fail++ }
}

# --- 0. auth: key issuance + unauthenticated access --------------------------
$token = (curl.exe -s -X POST "$base/api/keys" | ConvertFrom-Json).token
Check "POST /api/keys issues a token" (-not [string]::IsNullOrWhiteSpace($token))
$auth = "Authorization: Bearer $token"

$noAuthShorten = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H "Content-Type: application/json" -d '{\"url\":\"https://example.com\"}'
Check "shorten without a key is 401" ($noAuthShorten -eq '401')
$noAuthList = curl.exe -s -o NUL -w "%{http_code}" "$base/api/links"
Check "listing without a key is 401" ($noAuthList -eq '401')
$noAuthDelete = curl.exe -s -o NUL -w "%{http_code}" -X DELETE "$base/api/links/whatever"
Check "delete without a key is 401" ($noAuthDelete -eq '401')
$bogus = curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer not-a-real-key" "$base/api/links"
Check "a bogus key is 401" ($bogus -eq '401')

$tokenB = (curl.exe -s -X POST "$base/api/keys" | ConvertFrom-Json).token
$authB = "Authorization: Bearer $tokenB"

# --- 1. shorten a url --------------------------------------------------------
$resp = curl.exe -s -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/very/long/path?a=1\",\"expiresInSeconds\":3600}' | ConvertFrom-Json
$code = $resp.code
Check "shorten returns code ($code)" ($code -match '^[0-9a-zA-Z]{7}$')
Check "shorten returns shortUrl" ($resp.shortUrl -eq "$base/$code")

# --- 2. redirect twice (second is a cache hit) + Location header -------------
# redirects are public: a short link is shareable
$s1 = curl.exe -s -o NUL -w "%{http_code}" "$base/$code"
$s2 = curl.exe -s -o NUL -w "%{http_code}" "$base/$code"
$loc = (curl.exe -s -D - -o NUL "$base/$code" | Select-String -Pattern '^[Ll]ocation:').Line
Check "redirect 302 x2" ($s1 -eq '302' -and $s2 -eq '302')
Check "Location header correct" ($loc -match 'https://example.com/very/long/path')

# --- 3. stats after the async analytics write settles ------------------------
Start-Sleep -Milliseconds 1500
$stats = curl.exe -s -H $auth "$base/api/stats/$code" | ConvertFrom-Json
Check "stats counted 3 clicks ($($stats.totalClicks))" ($stats.totalClicks -eq 3)

# --- 4. custom alias + conflict ----------------------------------------------
$alias = "my-repo-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$st = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d "{\`"url\`":\`"https://github.com/torvalds\`",\`"customAlias\`":\`"$alias\`"}"
Check "custom alias created ($alias)" ($st -eq '201')
$dup = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d "{\`"url\`":\`"https://github.com\`",\`"customAlias\`":\`"$alias\`"}"
Check "duplicate alias rejected 409" ($dup -eq '409')
$al = curl.exe -s -o NUL -w "%{http_code}" "$base/$alias"
Check "alias redirect works" ($al -eq '302')

# --- 5. expiry: 2s ttl --------------------------------------------------------
$exp = curl.exe -s -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/short-lived\",\"expiresInSeconds\":2}' | ConvertFrom-Json
$alive = curl.exe -s -o NUL -w "%{http_code}" "$base/$($exp.code)"
Start-Sleep -Seconds 3
$dead = curl.exe -s -o NUL -w "%{http_code}" "$base/$($exp.code)"
$st404 = curl.exe -s -o NUL -w "%{http_code}" -H $auth "$base/api/stats/$($exp.code)"
Check "expiring link 302 before deadline ($alive)" ($alive -eq '302')
Check "expired link 410" ($dead -eq '410')
Check "expired link stats 404 (row swept)" ($st404 -eq '404')

# --- 6. invalid url -----------------------------------------------------------
$bad = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d '{\"url\":\"ftp://example.com\"}'
Check "invalid url rejected 400" ($bad -eq '400')

# --- 7. unknown code ----------------------------------------------------------
$miss = curl.exe -s -o NUL -w "%{http_code}" "$base/zzzzzzz"
Check "unknown code 404" ($miss -eq '404')

# --- 8. listing + keyset pagination -------------------------------------------
# limit=2 and three links, so the pagination branch always runs
curl.exe -s -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/pagination-seed\"}' | Out-Null
$listing = curl.exe -s -H $auth "$base/api/links?limit=2" | ConvertFrom-Json
Check "GET /api/links returns a page (n=$($listing.links.Count) of $($listing.total))" ($listing.links.Count -ge 1 -and $listing.links.Count -le 2 -and $listing.total -ge $listing.links.Count)
$firstCode = $listing.links[0].code
Check "newest link is first ($firstCode)" ($null -ne $firstCode)

if ($null -ne $listing.nextCursor) {
  $page2 = curl.exe -s -H $auth "$base/api/links?limit=2&cursor=$($listing.nextCursor)" | ConvertFrom-Json
  Check "cursor pagination returns the next page (n=$($page2.links.Count))" ($page2.links.Count -ge 1)
  Check "total is only counted on the first page" ($null -eq $page2.total)
  $overlap = @($page2.links | Where-Object { $_.code -eq $firstCode }).Count
  Check "pages do not overlap" ($overlap -eq 0)
}

$badCursor = curl.exe -s -o NUL -w "%{http_code}" -H $auth "$base/api/links?cursor=abc"
Check "invalid cursor rejected 400" ($badCursor -eq '400')

# --- 9. ownership isolation, then delete --------------------------------------
$delAlias = "del-test-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$delBody = "{\`"url\`":\`"https://example.com/to-delete\`",\`"customAlias\`":\`"$delAlias\`"}"
$delCode = (curl.exe -s -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d $delBody | ConvertFrom-Json).code

$bSees = @((curl.exe -s -H $authB "$base/api/links?limit=50" | ConvertFrom-Json).links | Where-Object { $_.code -eq $delCode }).Count
Check "another key cannot see the link in its listing" ($bSees -eq 0)

$bDelete = curl.exe -s -o NUL -w "%{http_code}" -X DELETE -H $authB "$base/api/links/$delCode"
$still = curl.exe -s -o NUL -w "%{http_code}" "$base/$delCode"
Check "another key cannot delete it (404) and it still resolves (302)" ($bDelete -eq '404' -and $still -eq '302')

$bStats = curl.exe -s -o NUL -w "%{http_code}" -H $authB "$base/api/stats/$delCode"
Check "stats are owner-only (404 for another key)" ($bStats -eq '404')

$before = curl.exe -s -o NUL -w "%{http_code}" "$base/$delCode"
$deleted = curl.exe -s -o NUL -w "%{http_code}" -X DELETE -H $auth "$base/api/links/$delCode"
$after = curl.exe -s -o NUL -w "%{http_code}" "$base/$delCode"
$afterStats = curl.exe -s -o NUL -w "%{http_code}" -H $auth "$base/api/stats/$delCode"
Check "owner delete: 302 -> DELETE 204 -> 404 (cache invalidated)" ($before -eq '302' -and $deleted -eq '204' -and $after -eq '404' -and $afterStats -eq '404')

$again = curl.exe -s -o NUL -w "%{http_code}" -X DELETE -H $auth "$base/api/links/$delCode"
Check "deleting a missing link returns 404" ($again -eq '404')

$stillListed = @((curl.exe -s -H $auth "$base/api/links?limit=50" | ConvertFrom-Json).links | Where-Object { $_.code -eq $delCode }).Count
Check "deleted link is gone from the listing" ($stillListed -eq 0)

# --- 10. rate limiter ---------------------------------------------------------
$seen = 0
for ($i = 0; $i -lt 40; $i++) {
  $code429 = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H $auth -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/rate-test\"}'
  if ($code429 -eq '429') { $seen++ }
}
Check "rate limiter trips (429 seen $seen)" ($seen -gt 0)

Write-Output ""
if ($fail -eq 0) { Write-Output "ALL CHECKS PASSED"; exit 0 } else { Write-Output "$fail CHECK(S) FAILED"; exit 1 }
