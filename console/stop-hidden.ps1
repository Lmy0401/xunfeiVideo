param(
    [int]$Port = 5177
)

$ErrorActionPreference = "Stop"
$consoleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $consoleDir "console-server.pid"

$pids = @()
if (Test-Path $pidFile) {
    $pids += Get-Content -Path $pidFile | ForEach-Object {
        if ($_ -match "^\d+$") { [int]$_ }
    }
}

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $pids += $listeners.OwningProcess
}

$pids = $pids | Sort-Object -Unique
foreach ($processId in $pids) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $processId -Force
    }
}

if (Test-Path $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force
}

Write-Host "Console server stopped."
