$path = ".\jcw-payroll-ci-key.json"
if (-not (Test-Path $path)) { Write-Output "Key file not found: $path"; exit 1 }
$raw = Get-Content -Raw $path
$b = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($raw))
$b | gh secret set GCP_SA_KEY_B64 --body - --repo nathangonzalez/jcw_payroll
Write-Output 'Uploaded GCP_SA_KEY_B64'