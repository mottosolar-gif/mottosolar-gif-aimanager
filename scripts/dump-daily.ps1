# dump-daily.ps1 -- pull the D1 database home once a day.
#
# Why this exists: IMPLEMENTATION_PLAN.md section 5 rule 2 says the cloud database must be
# dumped back to our own machine every day, because a free service can close at any time.
# The rule was written on 2026-08-27 and nothing implemented it; the only dump on disk was a
# near-empty LOCAL one, because "npm run db:dump" defaults to local. Anyone who ran it and
# believed they had a production backup was holding an empty file.
#
# ASCII only on purpose: PowerShell 5.1 reads a BOM-less file as ANSI and Thai text breaks
# the parser (house rule, learned the hard way).
#
# Registered as scheduled task "ksk-aim-dump". bin/selfcheck.php enumerates scheduled tasks,
# so a failure here surfaces through the existing watchdog -- no new watchdog is created.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $repo 'dumps\dump-daily.log'
$keepDays = 14

function Write-Log([string]$msg) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Output $line
}

try {
    New-Item -ItemType Directory -Force -Path (Join-Path $repo 'dumps') | Out-Null

    # Read the D1 token from .dev.vars (gitignored). Never echo the value.
    $devVars = Join-Path $repo '.dev.vars'
    if (-not (Test-Path $devVars)) { throw '.dev.vars not found -- cannot reach D1' }
    $token = $null
    foreach ($line in (Get-Content $devVars)) {
        if ($line -match '^\s*CLOUDFLARE_D1_TOKEN\s*=\s*(.+)\s*$') { $token = $Matches[1].Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'CLOUDFLARE_D1_TOKEN missing from .dev.vars' }
    # Strip surrounding quotes. Bash "source" removes them silently, PowerShell does not, so a
    # pasted 'quoted-token' works in one shell and fails in the other with the unhelpful message
    # "Invalid format for Authorization header". Cost us a debugging round on 2026-08-28.
    if (($token.StartsWith("'") -and $token.EndsWith("'")) -or
        ($token.StartsWith('"') -and $token.EndsWith('"'))) {
        $token = $token.Substring(1, $token.Length - 2)
    }

    $env:CLOUDFLARE_API_TOKEN = $token
    Push-Location $repo
    try {
        $before = @(Get-ChildItem -Path (Join-Path $repo 'dumps') -Filter 'aim-db-*.sql' -ErrorAction SilentlyContinue).Count
        # 2026-08-29: was "2>&1 | Out-Null". In PowerShell 5.1, merging a native exe stderr into
        # the pipeline wraps each line in a NativeCommandError, so ANY stderr output makes the
        # try/catch fire even when npm exited 0. npm prints an update notice to stderr every few
        # days -- so this task failed only on the days npm felt chatty. Took a selfcheck alert to find.
        # Trust the exit code, not the presence of stderr text.
        & npm run db:dump -- --remote | Out-Null
        if ($LASTEXITCODE -ne 0) { throw ('npm run db:dump exited ' + $LASTEXITCODE) }

        $files = @(Get-ChildItem -Path (Join-Path $repo 'dumps') -Filter 'aim-db-*.sql' |
                   Sort-Object LastWriteTime -Descending)
        if ($files.Count -le $before) { throw 'dump command reported success but wrote no new file' }

        $newest = $files[0]
        # A dump that is suspiciously small means the wrong database was reached (the local one
        # is nearly empty). Fail loudly rather than keeping a useless file and calling it a backup.
        if ($newest.Length -lt 10240) {
            throw ('dump is only ' + $newest.Length + ' bytes -- probably the local database, not production')
        }
        Write-Log ('OK  ' + $newest.Name + '  ' + [math]::Round($newest.Length / 1KB) + ' KB')

        $cutoff = (Get-Date).AddDays(-$keepDays)
        $stale = @($files | Where-Object { $_.LastWriteTime -lt $cutoff })
        foreach ($f in $stale) { Remove-Item $f.FullName -Force }
        if ($stale.Count -gt 0) { Write-Log ('pruned ' + $stale.Count + ' dump(s) older than ' + $keepDays + ' days') }
    } finally {
        Pop-Location
        $env:CLOUDFLARE_API_TOKEN = $null
    }
    exit 0
} catch {
    Write-Log ('FAIL  ' + $_.Exception.Message)
    exit 1
}
