$ErrorActionPreference = 'Stop'
$linkkeepRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $linkkeepRoot
$linkkeepStatePath = Join-Path $linkkeepRoot '.private/demo-session.json'
$linkkeepTool = Join-Path $linkkeepRoot '.private/tools/cloudflared.exe'
if (Test-Path -LiteralPath $linkkeepStatePath) {
    $linkkeepSession = Get-Content -LiteralPath $linkkeepStatePath -Raw | ConvertFrom-Json
    $linkkeepTunnel = Get-Process -Id $linkkeepSession.TunnelPid -ErrorAction SilentlyContinue
    if ($linkkeepTunnel) {
        if ($linkkeepTunnel.Path -ne $linkkeepTool -or
            $linkkeepTunnel.StartTime.ToUniversalTime().ToString('o') -ne $linkkeepSession.TunnelStartedAt) {
            throw 'PID was reused or belongs to another process; refusing to stop it.'
        }
        Stop-Process -Id $linkkeepTunnel.Id
    }
}
& docker compose -p linkkeep-demo -f compose.yaml -f compose.demo.yaml down
if ($LASTEXITCODE -ne 0) { throw 'Docker cleanup failed. Database volumes have not been deleted.' }
if (Test-Path -LiteralPath $linkkeepStatePath) { Remove-Item -LiteralPath $linkkeepStatePath }
Write-Output 'Demo stopped. Database and backup volumes are preserved.'
