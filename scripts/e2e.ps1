# end-to-end suite against a running api (Windows-friendly mirror of scripts/e2e.sh)
# usage: powershell -File scripts\e2e.ps1 -BaseUrl http://localhost:3000
param([string]$BaseUrl = "http://localhost:3000")

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$fail = 0

function Check($name, $cond) {
  if ($cond) { Write-Output "PASS  $name" } else { Write-Output "FAIL  $name"; $script:fail++ }
}

# --- 1. shorten a url -------------------------------------------------------
$resp = curl.exe -s -X POST "$base/api/shorten" -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/very/long/path?a=1\",\"expiresInSeconds\":3600}' | ConvertFrom-Json
$code = $resp.code
Check "shorten returns code ($code)" ($code -match '^[0-9a-zA-Z]{7}$')
Check "shorten returns shortUrl" ($resp.shortUrl -eq "$base/$code")

# --- 2. redirect twice (second is a cache hit) + Location header ------------
$s1 = curl.exe -s -o NUL -w "%{http_code}" "$base/$code"
$s2 = curl.exe -s -o NUL -w "%{http_code}" "$base/$code"
$loc = (curl.exe -s -D - -o NUL "$base/$code" | Select-String -Pattern '^[Ll]ocation:').Line
Check "redirect 302 x2" ($s1 -eq '302' -and $s2 -eq '302')
Check "Location header correct" ($loc -match 'https://example.com/very/long/path')

# --- 3. stats after the async analytics write settles -----------------------
Start-Sleep -Milliseconds 1500
$stats = curl.exe -s "$base/api/stats/$code" | ConvertFrom-Json
Check "stats counted 3 clicks ($($stats.totalClicks))" ($stats.totalClicks -eq 3)

# --- 4. custom alias + conflict ---------------------------------------------
$alias = "my-repo-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$st = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H "Content-Type: application/json" -d "{\`"url\`":\`"https://github.com/torvalds\`",\`"customAlias\`":\`"$alias\`"}"
Check "custom alias created ($alias)" ($st -eq '201')
$dup = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H "Content-Type: application/json" -d "{\`"url\`":\`"https://github.com\`",\`"customAlias\`":\`"$alias\`"}"
Check "duplicate alias rejected 409" ($dup -eq '409')
$al = curl.exe -s -o NUL -w "%{http_code}" "$base/$alias"
Check "alias redirect works" ($al -eq '302')

# --- 5. expiry: 2s ttl -------------------------------------------------------
$exp = curl.exe -s -X POST "$base/api/shorten" -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/short-lived\",\"expiresInSeconds\":2}' | ConvertFrom-Json
$alive = curl.exe -s -o NUL -w "%{http_code}" "$base/$($exp.code)"
Start-Sleep -Seconds 3
$dead = curl.exe -s -o NUL -w "%{http_code}" "$base/$($exp.code)"
$st404 = curl.exe -s -o NUL -w "%{http_code}" "$base/api/stats/$($exp.code)"
Check "expiring link 302 before deadline ($alive)" ($alive -eq '302')
Check "expired link 410" ($dead -eq '410')
Check "expired link stats 404 (row swept)" ($st404 -eq '404')

# --- 6. invalid url ----------------------------------------------------------
$bad = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H "Content-Type: application/json" -d '{\"url\":\"ftp://example.com\"}'
Check "invalid url rejected 400" ($bad -eq '400')

# --- 7. unknown code ---------------------------------------------------------
$miss = curl.exe -s -o NUL -w "%{http_code}" "$base/zzzzzzz"
Check "unknown code 404" ($miss -eq '404')

# --- 8. link listing + keyset pagination -------------------------------------
# limit=2 so pagination is exercised even on a fresh database
$listing = curl.exe -s "$base/api/links?limit=2" | ConvertFrom-Json
Check "GET /api/links returns a page (n=$($listing.links.Count) of $($listing.total))" ($listing.links.Count -ge 1 -and $listing.links.Count -le 2 -and $listing.total -ge $listing.links.Count)
$firstCode = $listing.links[0].code
Check "newest link is first ($firstCode)" ($null -ne $firstCode)

if ($null -ne $listing.nextCursor) {
  $page2 = curl.exe -s "$base/api/links?limit=2&cursor=$($listing.nextCursor)" | ConvertFrom-Json
  Check "cursor pagination returns the next page (n=$($page2.links.Count))" ($page2.links.Count -ge 1)
  Check "total is only counted on the first page" ($null -eq $page2.total)
  $overlap = @($page2.links | Where-Object { $_.code -eq $firstCode }).Count
  Check "pages do not overlap" ($overlap -eq 0)
}

$badCursor = curl.exe -s -o NUL -w "%{http_code}" "$base/api/links?cursor=abc"
Check "invalid cursor rejected 400" ($badCursor -eq '400')

# --- 9. delete ----------------------------------------------------------------
$delAlias = "del-test-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$delBody = "{\`"url\`":\`"https://example.com/to-delete\`",\`"customAlias\`":\`"$delAlias\`"}"
$delCode = (curl.exe -s -X POST "$base/api/shorten" -H "Content-Type: application/json" -d $delBody | ConvertFrom-Json).code
$before = curl.exe -s -o NUL -w "%{http_code}" "$base/$delCode"
$deleted = curl.exe -s -o NUL -w "%{http_code}" -X DELETE "$base/api/links/$delCode"
$after = curl.exe -s -o NUL -w "%{http_code}" "$base/$delCode"
$afterStats = curl.exe -s -o NUL -w "%{http_code}" "$base/api/stats/$delCode"
Check "delete: 302 -> DELETE 204 -> 404 (cache invalidated)" ($before -eq '302' -and $deleted -eq '204' -and $after -eq '404' -and $afterStats -eq '404')

$again = curl.exe -s -o NUL -w "%{http_code}" -X DELETE "$base/api/links/$delCode"
Check "deleting a missing link returns 404" ($again -eq '404')

$stillListed = @((curl.exe -s "$base/api/links?limit=50" | ConvertFrom-Json).links | Where-Object { $_.code -eq $delCode }).Count
Check "deleted link is gone from the listing" ($stillListed -eq 0)

# --- 10. rate limiter ----------------------------------------------------------
$seen = 0
for ($i = 0; $i -lt 40; $i++) {
  $code429 = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/rate-test\"}'
  if ($code429 -eq '429') { $seen++ }
}
Check "rate limiter trips (429 seen $seen)" ($seen -gt 0)

Write-Output ""
if ($fail -eq 0) { Write-Output "ALL CHECKS PASSED"; exit 0 } else { Write-Output "$fail CHECK(S) FAILED"; exit 1 }
