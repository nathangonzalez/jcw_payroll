param(
  [string]$Project,
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

$ver = "patch-$([int](Get-Date).ToUniversalTime().Subtract([datetime]'1970-01-01').TotalSeconds)"
Write-Output "Deploying version $ver (no promote)..."
& gcloud app deploy app.yaml --project $Project --version $ver --no-promote --quiet

Write-Output "Deployed $ver. To promote after smoke tests run:" 
Write-Output "  gcloud app services set-traffic default --splits $ver=1 --project=$Project --quiet"

if ($Seed) {
  Write-Output "Note: to seed in deployed env, use Invoke-RestMethod against the deployed URL or run seed from Cloud Shell."
}

Pop-Location
