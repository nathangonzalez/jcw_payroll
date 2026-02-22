param(
    [string]$InputPath = "C:\Users\natha\Downloads\Actions.xlsx",
    [string]$OutputDir = "",
    [switch]$Open
)

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) | ForEach-Object { Join-Path $_ "..\data\actions_export" })
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($InputPath)

$names = @()
foreach ($ws in $wb.Worksheets) {
    $name = $ws.Name
    $names += $name
    $safe = ($name -replace '[^A-Za-z0-9_-]', '_')
    $csv = Join-Path $OutputDir ("Actions-$safe.csv")
    $ws.SaveAs($csv, 6)
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

Write-Output ("Exported sheets: " + ($names -join ", "))
Write-Output ("CSV dir: " + $OutputDir)

if ($Open) {
    Invoke-Item $OutputDir
}
