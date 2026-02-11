$path = '.\run-latest.log'
if (-not (Test-Path $path)) { Write-Output "missing log: $path"; exit 1 }
$matches = Select-String -Path $path -Pattern 'failed to parse|unexpected token|BOM|∩┐|credentials_json' -Context 3,3
if ($matches) {
    foreach ($m in $matches) {
        Write-Output '-----'
        foreach ($l in $m.Context.PreContext) { Write-Output $l }
        Write-Output $m.Line
        foreach ($l in $m.Context.PostContext) { Write-Output $l }
    }
} else {
    Write-Output 'No matches found in run-latest.log'
}