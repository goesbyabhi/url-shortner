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

# --- 8. rate limiter ---------------------------------------------------------
$seen = 0
for ($i = 0; $i -lt 40; $i++) {
  $code429 = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/api/shorten" -H "Content-Type: application/json" -d '{\"url\":\"https://example.com/rate-test\"}'
  if ($code429 -eq '429') { $seen++ }
}
Check "rate limiter trips (429 seen $seen)" ($seen -gt 0)

Write-Output ""
if ($fail -eq 0) { Write-Output "ALL CHECKS PASSED"; exit 0 } else { Write-Output "$fail CHECK(S) FAILED"; exit 1 }
