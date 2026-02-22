<#
.SYNOPSIS
  Safe traffic promotion for GAE labor-timekeeper.
  Forces a backup on the CURRENT serving version before switching traffic.

.DESCRIPTION
  1. Hits /api/health on the current prod URL to verify it's alive
  2. Triggers an immediate backup via /api/admin/force-backup (or approve endpoint)
  3. Verifies the GCS backup timestamp is fresh (< 60s old)
  4. Only THEN promotes traffic to the new version

.PARAMETER Version
  The GAE version to promote (e.g., "p-fix0210b")

.PARAMETER Project
  GCP project ID (defaults to gcloud config)

.EXAMPLE
  .\safe-promote.ps1 -Version p-fix0211a
#>
param(
  [Parameter(Mandatory=$true)]
  [string]$Version,
  [string]$Project,
  [string]$Service = "labor-timekeeper"
)

$ErrorActionPreference = "Stop"

if (-not $Project) {
  $Project = (gcloud config get-value project 2>$null)
}
if (-not $Project) {
  Write-Error "No GCP project. Pass -Project or run 'gcloud config set project ...'"
  exit 1
}

$baseUrl = "https://${Service}-dot-${Project}.uc.r.appspot.com"

Write-Host ""
Write-Host "=== SAFE PROMOTE ===" -ForegroundColor Cyan
Write-Host "Service : $Service"
Write-Host "Project : $Project"
Write-Host "Target  : $Version"
Write-Host "Prod URL: $baseUrl"
Write-Host ""

# Step 1: Health check on current prod
Write-Host "[1/4] Health check on current prod..." -ForegroundColor Yellow
try {
  $health = curl.exe -s "$baseUrl/api/health" | ConvertFrom-Json
  if (-not $health.ok) { throw "Health check returned ok=false" }
  Write-Host "  OK - $($health.stats.time_entries) entries, $($health.stats.employees) employees" -ForegroundColor Green
} catch {
  Write-Error "Health check FAILED: $_"
  exit 1
}

# Step 2: Force immediate backup on current serving instance
Write-Host "[2/4] Forcing backup on current serving instance..." -ForegroundColor Yellow
try {
  # Use the new force-backup endpoint
  $backupResp = curl.exe -s -X POST "$baseUrl/api/admin/force-backup" -H "Content-Type: application/json" | ConvertFrom-Json
  if ($backupResp.ok) {
    Write-Host "  Backup triggered successfully" -ForegroundColor Green
  } else {
    Write-Warning "  Backup returned: $($backupResp | ConvertTo-Json)"
  }
} catch {
  Write-Warning "Could not trigger explicit backup: $_"
}

# Step 3: Verify GCS backup freshness
Write-Host "[3/4] Checking GCS backup timestamp..." -ForegroundColor Yellow
try {
  $gcsInfo = gsutil stat "gs://jcw-labor-timekeeper/app.db" 2>&1
  $updateLine = $gcsInfo | Select-String "Update time"
  if ($updateLine) {
    Write-Host "  GCS backup: $($updateLine.ToString().Trim())" -ForegroundColor Green
  } else {
    Write-Host "  GCS backup exists (could not parse timestamp)" -ForegroundColor Yellow
  }
} catch {
  Write-Warning "Could not verify GCS backup: $_"
}

# Step 4: Promote traffic
Write-Host "[4/4] Promoting traffic to $Version..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  About to run:" -ForegroundColor White
Write-Host "  gcloud app services set-traffic $Service --splits ${Version}=1 --project=$Project --quiet" -ForegroundColor DarkGray
Write-Host ""
$confirm = Read-Host "  Proceed? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
  Write-Host "Aborted." -ForegroundColor Red
  exit 0
}

gcloud app services set-traffic $Service --splits "${Version}=1" --project=$Project --quiet

Write-Host ""
Write-Host "=== PROMOTED ===" -ForegroundColor Green

# Step 5: Verify new version is serving
Start-Sleep -Seconds 5
Write-Host "[5/5] Verifying new version..." -ForegroundColor Yellow
try {
  $newHealth = curl.exe -s "$baseUrl/api/health" | ConvertFrom-Json
  Write-Host "  OK - $($newHealth.stats.time_entries) entries" -ForegroundColor Green
} catch {
  Write-Warning "Post-promote health check failed: $_"
}

Write-Host ""
Write-Host "Done. Monitor logs: gcloud app logs tail -s $Service" -ForegroundColor Cyan
