$env:PATH += ";C:\Program Files\GitHub CLI"
try {
    gh --version | Out-Null
    Write-Output "gh found: $(gh --version)"
} catch {
    Write-Output "gh not found or not runnable from PATH"
}

$js = gh run list --repo nathangonzalez/jcw_payroll --limit 1 --json url,headSha,conclusion,createdAt | ConvertFrom-Json
if ($js -and $js.Count -gt 0) {
    $u = $js[0].url
    $id = ($u -split '/')[-1]
    Write-Output "Latest run id: $id SHA:$($js[0].headSha) Conclusion:$($js[0].conclusion)"
    gh run view $id --repo nathangonzalez/jcw_payroll --log | Out-File -FilePath .\run-latest.log -Encoding utf8
    Write-Output 'Saved run-latest.log'
} else {
    Write-Output 'No runs found'
}