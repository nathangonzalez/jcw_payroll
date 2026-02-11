$PROJECT = 'jcw-2-android-estimator'
$SA_NAME = 'jcw-payroll-ci'
$SA_EMAIL = "$SA_NAME@$PROJECT.iam.gserviceaccount.com"
$KEY_PATH = '.\\jcw-payroll-ci-key.json'
$REPO = 'nathangonzalez/jcw_payroll'

Write-Output "Creating service account key at $KEY_PATH..."
gcloud iam service-accounts keys create $KEY_PATH --iam-account $SA_EMAIL --project $PROJECT
if (-not (Test-Path $KEY_PATH)) { Write-Error "Key not created at $KEY_PATH"; exit 1 }

# Check gh availability
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCmd) {
    Write-Output 'GitHub CLI (gh) not found in PATH. Attempting to install via winget...'
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Output 'Installing GitHub CLI via winget (non-interactive)...'
        winget install --id GitHub.cli -e --source winget --accept-source-agreements --accept-package-agreements
        Start-Sleep -Seconds 3
    } else {
        Write-Output 'winget not available. Please install GitHub CLI manually and re-run the script.'
        exit 2
    }
}

# Refresh gh command lookup
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCmd) { Write-Error 'gh not found after attempted install'; exit 3 }

# Ensure gh is authenticated
$auth = gh auth status 2>&1 | Out-String
if ($auth -match 'Logged in') {
    Write-Output 'gh is already authenticated'
} else {
    Write-Output 'Running gh auth login (web) - follow the interactive prompt to authenticate.'
    gh auth login --web
}

Write-Output "Uploading secret GCP_PROJECT_ID to $REPO"
gh secret set GCP_PROJECT_ID --body $PROJECT --repo $REPO

Write-Output "Uploading secret GCP_SA_KEY to $REPO from $KEY_PATH"
Get-Content -Raw $KEY_PATH | gh secret set GCP_SA_KEY --body - --repo $REPO

Write-Output "Removing local key $KEY_PATH"
Remove-Item $KEY_PATH -Force

Write-Output 'Creating empty commit to retrigger CI'
try { git commit --allow-empty -m 'ci: add GCP secrets' } catch { Write-Output 'No commit created' }
git push

Write-Output 'Script completed successfully.'
