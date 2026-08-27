$ErrorActionPreference = 'Stop'

$bridgeDir = $PSScriptRoot
$phpFiles = @(
    'aim_notify.php',
    'aim_notify.credentials.example.php',
    'aim_person_map.example.php',
    'api_aim_notify.php'
)
$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure($message) {
    $script:failures.Add($message)
}

foreach ($fileName in $phpFiles) {
    $filePath = Join-Path $bridgeDir $fileName
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        Add-Failure "missing file: $fileName"
        continue
    }

    $lintOutput = & php -l $filePath
    if ($LASTEXITCODE -ne 0) {
        Add-Failure "php -l failed: $fileName ($($lintOutput -join ' '))"
    }
}

$sourceByFile = @{}
foreach ($fileName in $phpFiles) {
    $filePath = Join-Path $bridgeDir $fileName
    if (Test-Path -LiteralPath $filePath -PathType Leaf) {
        $sourceByFile[$fileName] = [System.IO.File]::ReadAllText($filePath)
    }
}

$allSource = ($sourceByFile.Values -join "`n")
$unsupportedChecks = @(
    @{ Name = 'arrow function'; Pattern = '(?m)\bfn\s*\(' },
    @{ Name = 'null-coalescing assignment'; Pattern = '\?\?=' },
    @{ Name = 'strict_types declaration'; Pattern = '(?i)declare\s*\(\s*strict_types\s*=' },
    @{ Name = 'typed return'; Pattern = '(?m)function\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:' },
    @{ Name = 'typed property'; Pattern = '(?m)^\s*(?:public|protected|private)\s+(?:static\s+)?(?:\??[A-Za-z_\\][A-Za-z0-9_\\]*|array|callable|iterable)\s+\$[A-Za-z_][A-Za-z0-9_]*' }
)

foreach ($check in $unsupportedChecks) {
    if ($allSource -match $check.Pattern) {
        Add-Failure "PHP > 5.6 syntax found: $($check.Name)"
    }
}

$endpointSource = $sourceByFile['api_aim_notify.php']
if ($null -eq $endpointSource -or
    $endpointSource -notmatch "hash_equals\s*\(\s*\(string\)\s*\`$cfg\s*\[\s*'notify_key'\s*\]\s*,\s*\`$suppliedKey\s*\)") {
    Add-Failure 'notify_key is not compared with hash_equals()'
}
if ($null -ne $endpointSource -and
    $endpointSource -match "\`$cfg\s*\[\s*'notify_key'\s*\]\s*===") {
    Add-Failure 'notify_key is compared with ==='
}

$librarySource = $sourceByFile['aim_notify.php']
if ($null -eq $librarySource) {
    Add-Failure 'cannot inspect aim_send_task_card()'
} else {
    $filterMatch = [regex]::Match(
        $librarySource,
        "\`$safeTaskRef\s*=\s*preg_replace\s*\(\s*'/\[\^A-Za-z0-9_-\]/'\s*,\s*''\s*,\s*\(string\)\s*\`$taskRef\s*\)"
    )
    $postbackMatch = [regex]::Match($librarySource, "act=aim_(?:accept|reject)&task='\s*\.\s*\`$safeTaskRef")
    if (-not $filterMatch.Success) {
        Add-Failure 'task_ref is not filtered with the required preg_replace()'
    } elseif (-not $postbackMatch.Success -or $filterMatch.Index -ge $postbackMatch.Index) {
        Add-Failure 'task_ref is not filtered before postback use'
    }
}

foreach ($entry in $sourceByFile.GetEnumerator()) {
    $lines = $entry.Value -split "`r?`n"
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match '(?i)\b(?:echo|print|printf|error_log|ll_log)\b.*notify_key') {
            Add-Failure "notify_key may be exposed in $($entry.Key):$($index + 1)"
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "FAIL: $($failures.Count) check(s) failed"
    foreach ($failure in $failures) {
        Write-Host " - $failure"
    }
    exit 1
}

Write-Host 'PASS: php -l passed for 4/4 PHP files'
Write-Host 'PASS: no PHP > 5.6 syntax detected'
Write-Host 'PASS: notify_key uses hash_equals() and is not exposed'
Write-Host 'PASS: task_ref is filtered before postback use'
Write-Host 'PASS: 5/5 WP-P1-B2 safety checks passed'
