param(
    [string]$sha = '88257df',
    [int]$timeout = 600,
    [int]$interval = 5
)

Write-Output "Polling workflow runs for head SHA $sha..."
$elapsed = 0
$runId = 0

while ($elapsed -lt $timeout) {
    try {
        $resp = Invoke-RestMethod -Uri 'https://api.github.com/repos/nathangonzalez/jcw_payroll/actions/runs' -Headers @{ 'Accept' = 'application/vnd.github+json' } -UseBasicParsing
    } catch {
        Write-Output "Failed to query runs: $($_.Exception.Message)"
        Start-Sleep -Seconds $interval
        $elapsed += $interval
        continue
    }

    $latest = $resp.workflow_runs | Where-Object { $_.head_sha -like "$sha*" } | Select-Object -First 1
    if ($null -ne $latest) {
        Write-Output "Found run id $($latest.id) status $($latest.status) conclusion $($latest.conclusion)"
        if ($latest.status -eq 'completed') { $runId = $latest.id; break }
    } else {
        Write-Output 'no run yet'
    }

    Start-Sleep -Seconds $interval
    $elapsed += $interval
}

if ($runId -eq 0) {
    Write-Output 'Run not found or not completed within timeout'
    exit 0
}

try {
    $run = Invoke-RestMethod -Uri "https://api.github.com/repos/nathangonzalez/jcw_payroll/actions/runs/$runId" -Headers @{ 'Accept' = 'application/vnd.github+json' } -UseBasicParsing
    Write-Output "Run $runId finished with conclusion: $($run.conclusion)"
} catch {
    Write-Output "Failed to fetch run details: $($_.Exception.Message)"
}

try {
    $jobs = Invoke-RestMethod -Uri "https://api.github.com/repos/nathangonzalez/jcw_payroll/actions/runs/$runId/jobs" -Headers @{ 'Accept' = 'application/vnd.github+json' } -UseBasicParsing
    foreach ($job in $jobs.jobs) {
        Write-Output "Job: $($job.name) status:$($job.status) conclusion:$($job.conclusion)"
        foreach ($step in $job.steps) {
            Write-Output "  Step: $($step.name) conclusion:$($step.conclusion)"
        }
    }
} catch {
    Write-Output "Failed to fetch jobs summary: $($_.Exception.Message)"
}

try {
    $zipUrl = "https://api.github.com/repos/nathangonzalez/jcw_payroll/actions/runs/$runId/logs"
    Invoke-WebRequest -Uri $zipUrl -OutFile "run-$runId-logs.zip" -UseBasicParsing
    Write-Output "Downloaded logs to run-$runId-logs.zip"
} catch {
    Write-Output "Could not download logs ZIP: $($_.Exception.Message)"
}
