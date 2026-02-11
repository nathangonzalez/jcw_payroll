$logPath = ".\run-21076221182.log"
if (-not (Test-Path $logPath)) { Write-Output "Log file not found: $logPath"; exit 1 }
$log = Get-Content $logPath
$matches = Select-String -InputObject $log -Pattern 'Authenticate to GCP|gcloud|credentials|ERROR|error' -Context 3,3
if ($matches) {
    foreach ($m in $matches) {
        Write-Output '-----'
        foreach ($line in $m.Context.PreContext) { Write-Output $line }
        Write-Output $m.Line
        foreach ($line in $m.Context.PostContext) { Write-Output $line }
    }
} else {
    Write-Output 'No matching error lines found'
}