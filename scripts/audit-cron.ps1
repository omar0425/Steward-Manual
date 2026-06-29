# Standing "do these numbers make sense?" check, on a schedule.
#
# Captures /api/status, runs scripts/audit-metrics.js against it (domain-sense
# checks), and compares it to the PREVIOUS capture to flag drift - a figure that
# quietly goes wrong over time, not just one that's absurd in a single snapshot.
# Captures land in %USERPROFILE%\StewardAudits as dated JSON; copies older than
# KeepDays are pruned.
#
# /api/status is session-gated, so this needs a logged-in session cookie:
#   1. Sign in to the app in your browser.
#   2. DevTools -> Application -> Cookies -> copy the value of steward_sid.
#   3. Set it as an env var (sessions last ~30 days, so refresh ~monthly):
#        setx STEWARD_SESSION_COOKIE "<the steward_sid value>"
#        setx STEWARD_BASE_URL "https://your-app.up.railway.app"
#
# Usage:
#   powershell -File scripts\audit-cron.ps1 -BaseUrl https://app -Cookie <steward_sid>
#   powershell -File scripts\audit-cron.ps1            # uses the env vars above
#   powershell -File scripts\audit-cron.ps1 -StrictDrift   # drift -> non-zero exit
#   powershell -File scripts\audit-cron.ps1 -Ai            # also run the AI sense-check
#
# Schedule it daily at 09:05 (just after the backup pull):
#   schtasks /Create /SC DAILY /ST 09:05 /TN "Steward Metrics Audit" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\Omar\Steward-Manual\scripts\audit-cron.ps1\""
#
# Exit code is non-zero when the auditor FAILs (a hard sanity violation, or any
# drift when -StrictDrift is set), so a scheduled run surfaces trouble.

param(
  [string]$BaseUrl = $env:STEWARD_BASE_URL,
  [string]$Cookie = $env:STEWARD_SESSION_COOKIE,
  [string]$OutDir = (Join-Path $env:USERPROFILE 'StewardAudits'),
  [int]$KeepDays = 60,
  [switch]$StrictDrift,
  [switch]$Ai
)

if (-not $BaseUrl -or -not $Cookie) {
  Write-Error 'BaseUrl and Cookie are required (args or STEWARD_BASE_URL / STEWARD_SESSION_COOKIE env vars). See the header for how to get the session cookie.'
  exit 2
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$dest = Join-Path $OutDir "steward-status-$stamp.json"

# Find the most recent prior capture BEFORE we write today's (that's the baseline).
$prev = Get-ChildItem $OutDir -Filter 'steward-status-*.json' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

$req = @{
  Uri             = "$($BaseUrl.TrimEnd('/'))/api/status"
  Headers         = @{ Cookie = "steward_sid=$Cookie" }
  UseBasicParsing = $true
  ErrorAction     = 'Stop'
}
try {
  $resp = Invoke-WebRequest @req
} catch {
  Write-Error "Status fetch failed: $_  (is the session cookie still valid?)"
  exit 2
}

# Guard against a login redirect / error page being saved as if it were status.
$body = $resp.Content
try { $null = $body | ConvertFrom-Json } catch {
  Write-Error 'Response was not JSON - the session cookie is probably expired (got an HTML login page). Refresh STEWARD_SESSION_COOKIE.'
  exit 2
}
Set-Content -Path $dest -Value $body -Encoding utf8
Write-Output "Captured $dest"

$drill = Join-Path $PSScriptRoot 'audit-metrics.js'
$nodeArgs = @($drill, $dest)
if ($prev) { $nodeArgs += @('--baseline', $prev.FullName); Write-Output "Comparing against $($prev.Name)" }
if ($StrictDrift) { $nodeArgs += '--strict-drift' }
if ($Ai) { $nodeArgs += '--ai' }

& node @nodeArgs
$auditExit = $LASTEXITCODE

# Prune old captures.
Get-ChildItem $OutDir -Filter 'steward-status-*.json' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  ForEach-Object { Remove-Item $_.FullName -Force; Write-Output "Pruned $($_.Name)" }

if ($auditExit -ne 0) {
  Write-Error "Metrics audit reported FAIL (exit $auditExit) for $dest - review the findings above."
  exit $auditExit
}
Write-Output 'Metrics audit clean.'
