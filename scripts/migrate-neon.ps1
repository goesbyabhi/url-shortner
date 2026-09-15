# Applies pending migrations to a hosted Postgres (Neon) for the deployed API.
#
#   powershell -File scripts\migrate-neon.ps1
#
# The password is prompted for and never written to disk. For the local docker
# database you don't need this at all: `npm run migrate -w server` uses defaults.
#
# Note: the default host is Neon's DIRECT endpoint (no "-pooler"). Hyperdrive uses
# the pooled endpoint at runtime, but schema changes (DDL) belong on the direct one.

param(
  [string]$DbHost   = "ep-wandering-fire-b377sgwy.c-4.ap-southeast-1.aws.neon.tech",
  [string]$Database = "neondb",
  [string]$User     = "neondb_owner",
  [string]$Port     = "5432",
  [string]$Ssl      = "true",
  [string]$Password # optional; prompted when omitted (used for non-interactive runs)
)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path "$root\server\src\db\migrate-cli.ts")) {
  Write-Host "migrate-cli.ts not found - run from the repo root on the cloudflare-workers branch." -ForegroundColor Red
  exit 1
}

if (-not $Password) {
  $secure = Read-Host -Prompt "Password for $User@$DbHost" -AsSecureString
  $Password = [System.Net.NetworkCredential]::new("", $secure).Password
}

if ([string]::IsNullOrEmpty($Password)) {
  Write-Host "No password entered." -ForegroundColor Yellow
  exit 1
}

# The migrator reads these, the same variables the server uses.
$env:PGHOST     = $DbHost
$env:PGPORT     = $Port
$env:PGUSER     = $User
$env:PGPASSWORD = $Password
$env:PGDATABASE = $Database
$env:PGSSL      = $Ssl

Write-Host "Applying migrations to $DbHost/$Database as $User ..." -ForegroundColor Cyan

Push-Location $root
try {
  npm run migrate -w server
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ($code -eq 0) {
  Write-Host "`nDone. Verify the deployed worker:" -ForegroundColor Green
  Write-Host "  curl.exe -s -X POST https://snip-worker.abxisxekpanda.workers.dev/api/keys"
} else {
  Write-Host "`nMigration failed (exit $code) - check the password/host and retry." -ForegroundColor Red
}
exit $code
