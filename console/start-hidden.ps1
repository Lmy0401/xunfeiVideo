param(
    [int]$Port = 5177
)

$ErrorActionPreference = "Stop"
$consoleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $consoleDir "console-server.pid"
$stdoutLog = Join-Path $consoleDir "console-server.out.log"
$stderrLog = Join-Path $consoleDir "console-server.err.log"

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $existing.OwningProcess | Select-Object -First 1 | Set-Content -Path $pidFile -Encoding ASCII
    Write-Host "Console server is already running: http://127.0.0.1:$Port"
    exit 0
}

$nodeCommand = Get-Command node -ErrorAction Stop
$process = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList "server.js" `
    -WorkingDirectory $consoleDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

$process.Id | Set-Content -Path $pidFile -Encoding ASCII
Start-Sleep -Seconds 2

$started = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($started) {
    Write-Host "Console server started hidden: http://127.0.0.1:$Port"
    exit 0
}

Write-Error "Console server did not start. Check $stderrLog"
exit 1
