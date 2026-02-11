$p = ".\jcw-payroll-ci-key.json"
if (-not (Test-Path $p)) { Write-Error "Key file not found: $p"; exit 1 }
$b = [System.IO.File]::ReadAllBytes($p)
if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
    $b = $b[3..($b.Length-1)]
}
$s = [System.Text.Encoding]::UTF8.GetString($b)
$s | gh secret set GCP_SA_KEY --body -
gh secret set GCP_PROJECT_ID --body 'jcw-2-android-estimator'
Remove-Item $p
Write-Output 'Uploaded secrets and removed local key'