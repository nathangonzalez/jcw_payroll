# Locate gh.exe in common locations, add to PATH for this session, verify, and upload secrets
$candidates = @(
    'C:\Program Files\GitHub CLI\gh.exe',
    "$env:USERPROFILE\scoop\apps\gh\current\gh.exe",
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe",
    'C:\Program Files (x86)\GitHub CLI\gh.exe'
)
$found = $null
foreach ($p in $candidates) {
    if (Test-Path $p) { $found = $p; break }
}
if (-not $found) {
    Write-Output "gh.exe not found in common locations. Searched: $($candidates -join ';')"
    exit 2
}
$dir = Split-Path -Parent $found
if ($env:PATH -notlike "*${dir}*") {
    $env:PATH = "$env:PATH;$dir"
    Write-Output "Added $dir to PATH for this session"
} else {
    Write-Output "$dir already in PATH"
}

# Verify gh
try {
    $ver = gh --version 2>&1
    Write-Output "gh version: $ver"
} catch {
    Write-Output "Failed to run gh --version: $($_.Exception.Message)"
    exit 3
}

# Upload secrets
$KEY_PATH = '.\\jcw-payroll-ci-key.json'
if (-not (Test-Path $KEY_PATH)) { Write-Output "Key not found at $KEY_PATH"; exit 4 }

# Ensure gh authenticated
$auth = gh auth status 2>&1 | Out-String
if ($auth -match 'Logged in') {
    Write-Output 'gh is authenticated'
} else {
    Write-Output 'gh is not authenticated. Running interactive login (web) - please complete login in browser.'
    gh auth login --web
}

$REPO = 'nathangonzalez/jcw_payroll'
Write-Output "Setting secret GCP_PROJECT_ID to 'jcw-2-android-estimator' for repo $REPO"
gh secret set GCP_PROJECT_ID --body 'jcw-2-android-estimator' --repo $REPO

Write-Output "Uploading GCP_SA_KEY from $KEY_PATH to $REPO"
Get-Content -Raw $KEY_PATH | gh secret set GCP_SA_KEY --body - --repo $REPO

Write-Output "Removing local key $KEY_PATH"
Remove-Item $KEY_PATH -Force

Write-Output 'Creating empty commit to retrigger CI'
try { git commit --allow-empty -m 'ci: add GCP secrets (uploaded via locate script)' } catch { Write-Output 'No commit created' }
git push

Write-Output 'Completed locate-and-upload script.'
