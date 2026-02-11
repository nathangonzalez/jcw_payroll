param([string]$runId = '21077808672')
Write-Output "Waiting for run $runId to complete..."
$timeout = 600
$interval = 5
$elapsed = 0
while ($elapsed -lt $timeout) {
    $r = gh api repos/nathangonzalez/jcw_payroll/actions/runs/$runId --jq '.status + " " + .conclusion'
    Write-Output "Run $runId state: $r"
    if ($r -like 'completed*') { break }
    Start-Sleep -Seconds $interval
    $elapsed += $interval
}
gh run view $runId --repo nathangonzalez/jcw_payroll --log | Out-File -FilePath ".\\run-$runId.log" -Encoding utf8
Write-Output "Saved run log to run-$runId.log"