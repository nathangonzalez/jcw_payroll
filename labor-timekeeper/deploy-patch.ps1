param(
  [string]$Project,
  [string]$Version,
  [switch]$Seed
)

if (-not $Project) {
  $Project = (gcloud config get-value project 2>$null)
}
if (-not $Project) {
  Write-Error "No GCP project specified. Pass -Project or run 'gcloud config set project YOUR_PROJECT'"
  exit 1
}

Write-Output "Deploying patch to project: $Project"
Push-Location -Path (Split-Path -Path $MyInvocation.MyCommand.Definition -Parent)

# ensure dependencies
Write-Output "Installing production dependencies..."
npm ci --production

# Use short version names (jcw1, jcw2, etc.) - long names blocked by browser firewall
if (-not $Version) {
  # Auto-increment: find latest jcwN version and bump
  $existing = gcloud app versions list --service=labor-timekeeper --project=$Project --format="value(version.id)" 2>$null | Where-Object { $_ -match '^jcw\d+$' }
  $maxNum = 0
  foreach ($v in $existing) {
    if ($v -match 'jcw(\d+)') { $n = [int]$Matches[1]; if ($n -gt $maxNum) { $maxNum = $n } }
  }
  $Version = "jcw$($maxNum + 1)"
}
$ver = $Version
Write-Output "Deploying version $ver (no promote)..."
& gcloud app deploy app.yaml --project $Project --version $ver --no-promote --quiet

Write-Output "Deployed $ver. To promote after smoke tests run:" 
Write-Output "  gcloud app services set-traffic default --splits $ver=1 --project=$Project --quiet"

if ($Seed) {
  Write-Output "Note: to seed in deployed env, use Invoke-RestMethod against the deployed URL or run seed from Cloud Shell."
}

Pop-Location
