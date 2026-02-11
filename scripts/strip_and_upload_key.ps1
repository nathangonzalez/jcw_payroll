$path = ".\jcw-payroll-ci-key.json"
if (-not (Test-Path $path)) { Write-Output "Key file not found: $path"; exit 1 }
$raw = Get-Content -Raw $path
if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) {
    Write-Output 'BOM present; removing BOM prefix'
    $raw = $raw.TrimStart([char]0xFEFF)
}
$raw | gh secret set GCP_SA_KEY --body - --repo nathangonzalez/jcw_payroll
Write-Output 'Uploaded GCP_SA_KEY'