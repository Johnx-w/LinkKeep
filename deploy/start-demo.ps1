param(
    [Parameter(Mandatory = $true)]
    [string]$CopyrightEmail
)
$ErrorActionPreference = 'Stop'
$linkkeepRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $linkkeepRoot
if ($CopyrightEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $CopyrightEmail -match 'example\.(com|org|net)') {
    throw 'Provide a real contact email address, not a password.'
}
$linkkeepTool = Join-Path $linkkeepRoot '.private/tools/cloudflared.exe'
$linkkeepStatePath = Join-Path $linkkeepRoot '.private/demo-session.json'
if (-not (Test-Path -LiteralPath $linkkeepTool)) { throw 'Official cloudflared executable is missing from .private/tools.' }
$linkkeepExpectedHash = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'
if ((Get-FileHash -LiteralPath $linkkeepTool -Algorithm SHA256).Hash.ToLowerInvariant() -ne $linkkeepExpectedHash) {
    throw 'cloudflared 2026.9.3 failed its official SHA256 check.'
}
if (-not (Test-Path -LiteralPath '.env')) { throw 'Local .env with operator credentials is required.' }
if (Test-Path -LiteralPath $linkkeepStatePath) {
    $linkkeepPrevious = Get-Content -LiteralPath $linkkeepStatePath -Raw | ConvertFrom-Json
    $linkkeepPreviousProcess = Get-Process -Id $linkkeepPrevious.TunnelPid -ErrorAction SilentlyContinue
    if ($linkkeepPreviousProcess -and $linkkeepPreviousProcess.Path -eq $linkkeepTool -and
        $linkkeepPreviousProcess.StartTime.ToUniversalTime().ToString('o') -eq $linkkeepPrevious.TunnelStartedAt) {
        Write-Output ('Demo is already running: ' + $linkkeepPrevious.Url)
        Write-Output 'Run deploy/stop-demo.ps1 before starting another session.'
        exit 0
    }
}
& docker version --format '{{.Server.Version}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop before running the demo.' }
New-Item -ItemType Directory -Force -Path 'artifacts/demo' | Out-Null
$linkkeepRunId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$linkkeepStdout = Join-Path $linkkeepRoot ('artifacts/demo/tunnel-' + $linkkeepRunId + '.out.log')
$linkkeepStderr = Join-Path $linkkeepRoot ('artifacts/demo/tunnel-' + $linkkeepRunId + '.err.log')
$linkkeepTunnel = Start-Process -FilePath $linkkeepTool -ArgumentList @(
    'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:8080'
) -WindowStyle Hidden -RedirectStandardOutput $linkkeepStdout -RedirectStandardError $linkkeepStderr -PassThru
try {
    $linkkeepUrl = $null
    for ($linkkeepAttempt = 0; $linkkeepAttempt -lt 90; $linkkeepAttempt++) {
        $linkkeepTunnel.Refresh()
        if ($linkkeepTunnel.HasExited) { throw 'Tunnel exited; inspect artifacts/demo/tunnel-*.err.log.' }
        $linkkeepLogs = (Get-Content -LiteralPath $linkkeepStdout -Raw -ErrorAction SilentlyContinue) +
            (Get-Content -LiteralPath $linkkeepStderr -Raw -ErrorAction SilentlyContinue)
        if ($linkkeepLogs -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $linkkeepUrl = $Matches[0]
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $linkkeepUrl) { throw 'No temporary HTTPS URL received; inspect the tunnel log.' }

    $linkkeepUpdates = @{
        APP_ORIGIN = $linkkeepUrl
        COPYRIGHT_EMAIL = $CopyrightEmail
        TRUST_PROXY_HEADERS = 'true'
        PROXY_MONTHLY_BUDGET_CENTS = '200'
    }
    $linkkeepLines = @(Get-Content -LiteralPath '.env')
    foreach ($linkkeepName in $linkkeepUpdates.Keys) {
        $linkkeepFound = $false
        $linkkeepLines = @($linkkeepLines | ForEach-Object {
            if ($_.StartsWith($linkkeepName + '=')) {
                $linkkeepFound = $true
                $linkkeepName + '=' + $linkkeepUpdates[$linkkeepName]
            } else { $_ }
        })
        if (-not $linkkeepFound) { $linkkeepLines += $linkkeepName + '=' + $linkkeepUpdates[$linkkeepName] }
    }
    [System.IO.File]::WriteAllText((Join-Path $linkkeepRoot '.private/demo.env'),
        ($linkkeepLines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
    & docker compose -p linkkeep-demo -f compose.yaml -f compose.demo.yaml up -d --build --wait --wait-timeout 120
    if ($LASTEXITCODE -ne 0) { throw 'Demo startup failed. Existing database volumes are preserved.' }
    $linkkeepSession = @{
        Url = $linkkeepUrl
        TunnelPid = $linkkeepTunnel.Id
        TunnelStartedAt = $linkkeepTunnel.StartTime.ToUniversalTime().ToString('o')
        TunnelExe = $linkkeepTool
    }
    [System.IO.File]::WriteAllText($linkkeepStatePath, ($linkkeepSession | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    Write-Output ''
    Write-Output ('Demo ready: ' + $linkkeepUrl)
    Write-Output ('Admin: ' + $linkkeepUrl + '/admin')
    Write-Output 'Stop: powershell -NoProfile -File deploy/stop-demo.ps1'
    Write-Output 'Keep this computer awake. The address is temporary; this is not a public launch acceptance.'
} catch {
    $linkkeepTunnel.Refresh()
    if (-not $linkkeepTunnel.HasExited) { Stop-Process -Id $linkkeepTunnel.Id }
    & docker compose -p linkkeep-demo -f compose.yaml -f compose.demo.yaml down
    throw
}
