# Verifies active gcloud account and whether it has owner or iam.serviceAccountAdmin on the project
$PROJECT_ID = 'jcw-2-android-estimator'
$account = gcloud auth list --filter='status:ACTIVE' --format='value(account)'
if (-not $account) {
    Write-Output "No active gcloud account found"
    exit 10
}
Write-Output "Active account: $account"

# Set project
gcloud config set project $PROJECT_ID | Out-Null
Write-Output "Project set to: $(gcloud config get-value project)"

# Try to fetch IAM policy
try {
    $raw = gcloud projects get-iam-policy $PROJECT_ID --format=json
} catch {
    Write-Output "Failed to fetch IAM policy: insufficient permissions or project not found"
    exit 11
}

$policy = $raw | ConvertFrom-Json
$rolesToCheck = @('roles/owner','roles/iam.serviceAccountAdmin')
$found = $false

foreach ($b in $policy.bindings) {
    if ($rolesToCheck -contains $b.role) {
        foreach ($m in $b.members) {
            if ($m -eq "user:$account" -or $m -eq "serviceAccount:$account" -or $m -eq "group:$account") {
                Write-Output "Found binding: $($b.role) -> $m"
                $found = $true
            }
        }
    }
}

if ($found) {
    Write-Output 'Account appears to have required role(s)'
    exit 0
} else {
    Write-Output 'Account does not have owner or iam.serviceAccountAdmin on project'
    exit 12
}