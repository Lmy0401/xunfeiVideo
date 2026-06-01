param(
    [string]$AdbPath = "D:\Develop\platform-tools\adb.exe",
    [string]$Keys,
    [ValidateSet("nine", "qwerty")]
    [string]$Layout = "nine",
    [int]$DelayMs = 120,
    [switch]$TapFirstCandidate,
    [ValidateRange(1, 5)]
    [int]$CandidateIndex = 0,
    [switch]$TapAppSend,
    [string]$CommitText,
    [switch]$SendAfterCommit,
    [int]$CommitDelayMs = 220,
    [int]$StartDelayMs = 450,
    [switch]$SkipEnsureIme
)

if (-not $Keys) {
    Write-Error "Usage: .\tools\ime-tap-playback.ps1 -Keys 'tianhuanle' [-Layout nine|qwerty] [-TapFirstCandidate] [-TapAppSend]"
    exit 1
}

if (-not (Test-Path $AdbPath)) {
    Write-Error "ADB not found: $AdbPath"
    exit 1
}

$component = "com.xunfei.video.showcase/.MainActivity"

# Coordinates are calibrated for the current fixed test device:
# 1080x2400, portrait, Chinese IME visible.
$nineKeyCenters = @{
    "a" = @(540, 1780); "b" = @(540, 1780); "c" = @(540, 1780)
    "d" = @(765, 1780); "e" = @(765, 1780); "f" = @(765, 1780)
    "g" = @(315, 1930); "h" = @(315, 1930); "i" = @(315, 1930)
    "j" = @(540, 1930); "k" = @(540, 1930); "l" = @(540, 1930)
    "m" = @(765, 1930); "n" = @(765, 1930); "o" = @(765, 1930)
    "p" = @(315, 2080); "q" = @(315, 2080); "r" = @(315, 2080); "s" = @(315, 2080)
    "t" = @(540, 2080); "u" = @(540, 2080); "v" = @(540, 2080)
    "w" = @(765, 2080); "x" = @(765, 2080); "y" = @(765, 2080); "z" = @(765, 2080)
}

$qwertyKeyCenters = @{
    "q" = @(54, 1780);  "w" = @(162, 1780); "e" = @(270, 1780); "r" = @(378, 1780); "t" = @(486, 1780)
    "y" = @(594, 1780); "u" = @(702, 1780); "i" = @(810, 1780); "o" = @(918, 1780); "p" = @(1026, 1780)
    "a" = @(108, 1930); "s" = @(216, 1930); "d" = @(324, 1930); "f" = @(432, 1930); "g" = @(540, 1930)
    "h" = @(648, 1930); "j" = @(756, 1930); "k" = @(864, 1930); "l" = @(972, 1930)
    "z" = @(216, 2080); "x" = @(324, 2080); "c" = @(432, 2080); "v" = @(540, 2080); "b" = @(648, 2080)
    "n" = @(756, 2080); "m" = @(864, 2080)
}

$keyCenters = if ($Layout -eq "qwerty") { $qwertyKeyCenters } else { $nineKeyCenters }

$nineSpecialCenters = @{
    "backspace" = @(980, 1780); "delete" = @(980, 1780); "del" = @(980, 1780); "bksp" = @(980, 1780)
    "enter" = @(980, 2080); "newline" = @(980, 2080)
    "space" = @(540, 2230)
    "symbol" = @(90, 2230); "symbols" = @(90, 2230)
    "comma" = @(90, 1780); "," = @(90, 1780)
    "period" = @(90, 1930); "." = @(90, 1930)
    "question" = @(90, 2050); "?" = @(90, 2050)
    "exclamation" = @(90, 2160); "!" = @(90, 2160)
}

$qwertySpecialCenters = @{
    "backspace" = @(1000, 2080); "delete" = @(1000, 2080); "del" = @(1000, 2080); "bksp" = @(1000, 2080)
    "enter" = @(1000, 2230); "newline" = @(1000, 2230)
    "space" = @(540, 2230)
    "symbol" = @(80, 2230); "symbols" = @(80, 2230)
}

$specialCenters = if ($Layout -eq "qwerty") { $qwertySpecialCenters } else { $nineSpecialCenters }

function Invoke-Tap($x, $y) {
    & $AdbPath shell input tap $x $y | Out-Null
    Start-Sleep -Milliseconds $DelayMs
}

function Send-AppScript($scriptObject) {
    $script = $scriptObject | ConvertTo-Json -Compress -Depth 8
    $scriptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
    & $AdbPath shell am start -n $component --es scriptBase64 $scriptBase64 | Out-Null
}

function Test-ImeShown {
    $state = & $AdbPath shell dumpsys input_method
    return ($state -match "mInputShown=true" -or $state -match "inputShown=true" -or $state -match "imeVisible=true")
}

function Ensure-ImeShown {
    Send-AppScript @{
        actions = @(
            @{
                type = "focusInput"
            }
        )
    }
    Start-Sleep -Milliseconds 700

    if (Test-ImeShown) {
        return
    }

    # Fallback for an older APK that does not know focusInput yet.
    & $AdbPath shell am start -n $component | Out-Null
    Start-Sleep -Milliseconds 500
    Invoke-Tap 540 1455
    Start-Sleep -Milliseconds 700
}

function Get-KeyTokens($value) {
    $tokens = New-Object System.Collections.Generic.List[string]
    $i = 0
    while ($i -lt $value.Length) {
        if ($value[$i] -eq "{") {
            $end = $value.IndexOf("}", $i + 1)
            if ($end -gt $i) {
                $tokens.Add($value.Substring($i + 1, $end - $i - 1).ToLowerInvariant())
                $i = $end + 1
                continue
            }
        }

        $tokens.Add(([string]$value[$i]).ToLowerInvariant())
        $i++
    }
    return $tokens
}

if (-not $SkipEnsureIme) {
    Ensure-ImeShown
    Start-Sleep -Milliseconds $StartDelayMs
}

foreach ($key in Get-KeyTokens $Keys) {
    if ($key -eq " ") {
        Start-Sleep -Milliseconds ($DelayMs * 2)
        continue
    }

    if ($keyCenters.ContainsKey($key)) {
        $point = $keyCenters[$key]
        Invoke-Tap $point[0] $point[1]
        continue
    }

    if ($specialCenters.ContainsKey($key)) {
        $point = $specialCenters[$key]
        Invoke-Tap $point[0] $point[1]
        continue
    }

    if (-not $keyCenters.ContainsKey($key)) {
        Write-Error "Unsupported key: $key. Use letters or tokens like {backspace}, {space}, {enter}, {symbol}."
        exit 1
    }
}

if ($TapFirstCandidate -and $CandidateIndex -eq 0) {
    $CandidateIndex = 1
}

if ($CandidateIndex -gt 0) {
    # Candidate row is above the keyboard. These slots are calibrated for the current IME
    # on 1080x2400. Candidate word widths vary, so recalibrate if a theme/layout shifts it.
    $candidateX = @(150, 330, 510, 690, 870)[$CandidateIndex - 1]
    Invoke-Tap $candidateX 1605
    Start-Sleep -Milliseconds $CommitDelayMs
}

if ($CommitText) {
    $actions = @(
        @{
            type = "commitText"
            text = $CommitText
        },
        @{
            type = "wait"
            duration = $CommitDelayMs
        }
    )

    if ($SendAfterCommit) {
        $actions += @{
            type = "send"
        }
    }

    Send-AppScript @{
        actions = $actions
    }
    Start-Sleep -Milliseconds ($CommitDelayMs + 500)
}

if (-not $CommitText -and $SendAfterCommit) {
    Send-AppScript @{
        actions = @(
            @{
                type = "wait"
                duration = $CommitDelayMs
            },
            @{
                type = "send"
            }
        )
    }
    Start-Sleep -Milliseconds ($CommitDelayMs + 500)
}

if ($TapAppSend) {
    # App send button position when the input bar is above the IME on 1080x2400.
    Invoke-Tap 1000 1455
}
