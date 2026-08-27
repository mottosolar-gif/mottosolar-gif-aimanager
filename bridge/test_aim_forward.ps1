$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$forwardPath = Join-Path $bridgeDir 'aim_forward.php'
$configPath = Join-Path $bridgeDir 'aim.credentials.example.php'
$source = [System.IO.File]::ReadAllText($forwardPath)

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw "FAIL: $Message"
    }
    Write-Output "PASS: $Message"
}

$php = Get-Command php -ErrorAction SilentlyContinue
if ($null -ne $php) {
    & $php.Source -l $forwardPath
    if ($LASTEXITCODE -ne 0) { throw 'FAIL: PHP lint failed for aim_forward.php' }
    & $php.Source -l $configPath
    if ($LASTEXITCODE -ne 0) { throw 'FAIL: PHP lint failed for aim.credentials.example.php' }
} else {
    Write-Output 'SKIP: php executable not found; PHP syntax lint was not run.'
}

Assert-True ($source -notmatch '\bfn\s*\(') 'No arrow function (fn)'
Assert-True ($source -notmatch '\?\?=') 'No null coalescing assignment (??=)'
Assert-True ($source -notmatch 'declare\s*\(\s*strict_types') 'No declare(strict_types=1)'
Assert-True ($source -notmatch '(?m)^\s*(public|protected|private)\s+(static\s+)?[A-Za-z_\\][A-Za-z0-9_\\]*\s+\$') 'No typed property'
Assert-True ($source -notmatch '(?m)^\s*function\s+aim_forward_events\s*\([^)]*\)\s*:') 'No return type declaration'
Assert-True ($source -notmatch 'function\s+aim_forward_events\s*\([^)]*(int|string|float|bool|array|callable)\s+\$') 'No scalar parameter type declaration'
Assert-True ($source -match 'CURLOPT_TIMEOUT_MS\s*=>\s*1500') 'Request timeout is 1500 ms'
Assert-True ($source -match 'CURLOPT_CONNECTTIMEOUT_MS\s*=>\s*1500') 'Connect timeout is 1500 ms'
$emptyGroupGuard = [regex]::Escape("if (`$testGroupId === '') return;")
Assert-True ($source -match $emptyGroupGuard) 'Empty test_group_id stops forwarding'

$curlCalls = [regex]::Matches($source, '(?m)(?<![A-Za-z0-9_])(@?)curl_(init|setopt_array|setopt|exec|getinfo|close)\s*\(')
Assert-True ($curlCalls.Count -eq 6) 'Found all 6 expected curl calls'
foreach ($call in $curlCalls) {
    Assert-True ($call.Groups[1].Value -eq '@') ("curl_{0} has error suppression" -f $call.Groups[2].Value)
}

$logCalls = [regex]::Matches($source, '(?m)^\s*@ll_log\((.+)\);\s*$')
Assert-True ($logCalls.Count -eq 2) 'Found only the success and error log calls'
foreach ($logCall in $logCalls) {
    $argument = $logCall.Groups[1].Value
    Assert-True ($argument -notmatch '\$(events|ev|payload|gid|testGroupId)\b') 'Log call contains no event content (event count is allowed)'
}

Write-Output 'PASS: static safety checks completed.'
