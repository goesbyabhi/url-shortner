# deploys the full production stack: postgres, redis, api, nginx (web)
# usage:
#   powershell -File scripts\deploy.ps1                       # local rehearsal on :8080
#   powershell -File scripts\deploy.ps1 -BaseUrl https://snip.example.com
#   powershell -File scripts\deploy.ps1 -Down                 # tear the stack down
param(
  [string]$BaseUrl = "http://localhost:8080",
  [switch]$Down
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

if ($Down) {
  docker compose -f "$root/compose.prod.yml" down
  exit 0
}

$env:BASE_URL = $BaseUrl

Write-Host "==> building images…" -ForegroundColor Cyan
docker compose -f "$root/compose.prod.yml" build

Write-Host "==> starting stack…" -ForegroundColor Cyan
docker compose -f "$root/compose.prod.yml" up -d
docker compose -f "$root/compose.prod.yml" ps

Write-Host ""
Write-Host "up at $BaseUrl" -ForegroundColor Green
Write-Host "verify: $BaseUrl/api/health"
