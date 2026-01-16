# Creates CI service account, grants roles, creates key, uploads GitHub secrets, and retriggers CI
$PROJECT_ID = 'jcw-2-android-estimator'
$SA_NAME = 'jcw-payroll-ci'
$SA_DISPLAY_NAME = 'JCW Payroll CI Deploy'
$SA_EMAIL = "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
$KEY_PATH = '.\jcw-payroll-ci-key.json'
$REPO = 'nathangonzalez/jcw_payroll'

Write-Output "Using project: $PROJECT_ID"
Write-Output "Service account: $SA_EMAIL"

# Check if SA exists
$exists = gcloud iam service-accounts list --filter="email:$SA_EMAIL" --format="value(email)" | Out-String
if ($exists.Trim() -eq '') {
    Write-Output "Creating service account $SA_NAME..."
    gcloud iam service-accounts create $SA_NAME --display-name "$SA_DISPLAY_NAME"
} else {
    Write-Output "Service account already exists, skipping creation"
}

# Grant roles (idempotent)
$roles = @(
    'roles/appengine.deployer',
    'roles/appengine.serviceAdmin',
    'roles/cloudbuild.builds.editor',
    'roles/iam.serviceAccountUser',
    'roles/storage.admin'
)
foreach ($r in $roles) {
    Write-Output "Granting $r to $SA_EMAIL..."
    gcloud projects add-iam-policy-binding $PROJECT_ID --member "serviceAccount:$SA_EMAIL" --role $r
}

# Create key
Write-Output "Creating JSON key at $KEY_PATH..."
if (Test-Path $KEY_PATH) { Remove-Item $KEY_PATH -Force }
gcloud iam service-accounts keys create $KEY_PATH --iam-account $SA_EMAIL --project $PROJECT_ID
if (-not (Test-Path $KEY_PATH)) { Write-Error "Failed to create key file"; exit 1 }

# Upload GitHub secrets
Write-Output "Uploading GitHub secrets to $REPO (requires gh login)..."
# Ensure gh authenticated
$ghStatus = gh auth status 2>&1 | Out-String
if ($ghStatus -match 'Logged in') {
    Write-Output 'gh is authenticated'
} else {
    Write-Output 'gh not authenticated - running gh auth login (interactive)'
    gh auth login
}

Write-Output "Setting secret GCP_PROJECT_ID..."
gh secret set GCP_PROJECT_ID --body $PROJECT_ID --repo $REPO

Write-Output "Setting secret GCP_SA_KEY from $KEY_PATH..."
$keyBytes = [System.IO.File]::ReadAllBytes($KEY_PATH)
if ($keyBytes.Length -ge 3 -and $keyBytes[0] -eq 0xEF -and $keyBytes[1] -eq 0xBB -and $keyBytes[2] -eq 0xBF) {
    $keyBytes = $keyBytes[3..($keyBytes.Length-1)]
}
$cleanKeyPath = '.\jcw-payroll-ci-key.clean.json'
[System.IO.File]::WriteAllBytes($cleanKeyPath, $keyBytes)
cmd /c type "$cleanKeyPath" | gh secret set GCP_SA_KEY --body - --repo $REPO

Write-Output "Setting secret GCP_SA_KEY_B64 from $KEY_PATH..."
$keyB64 = [Convert]::ToBase64String($keyBytes)
gh secret set GCP_SA_KEY_B64 --body "$keyB64" --repo $REPO

# Remove local file
Write-Output "Removing local key file $KEY_PATH"
Remove-Item $KEY_PATH -Force
if (Test-Path $cleanKeyPath) { Remove-Item $cleanKeyPath -Force }

# Retrigger CI by empty commit
Write-Output "Creating empty commit to retrigger CI and pushing..."
try { git commit --allow-empty -m 'ci: add GCP secrets' } catch { Write-Output 'No commit created' }
git push

Write-Output 'Done.'
