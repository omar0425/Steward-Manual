# Pull an off-site backup of the Steward database from the production server.
#
# Usage:
#   powershell -File scripts\pull-backup.ps1 -BaseUrl https://your-app.up.railway.app -Token YOUR_TOKEN
#
# Or set the environment variables STEWARD_BASE_URL / STEWARD_BACKUP_TOKEN and
# run it with no arguments. Backups land in %USERPROFILE%\StewardBackups with
# a dated filename; copies older than 30 days are pruned.
#
# To run automatically every day at 09:00 (one-time setup, run as your user):
#   schtasks /Create /SC DAILY /ST 09:00 /TN "Steward DB Backup" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\Omar\Steward-Manual\scripts\pull-backup.ps1\""

param(
  [string]$BaseUrl = $env:STEWARD_BASE_URL,
  [string]$Token = $env:STEWARD_BACKUP_TOKEN,
  [string]$OutDir = (Join-Path $env:USERPROFILE 'StewardBackups'),
  [int]$KeepDays = 30
)

if (-not $BaseUrl -or -not $Token) {
  Write-Error 'BaseUrl and Token are required (args or STEWARD_BASE_URL / STEWARD_BACKUP_TOKEN env vars).'
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$dest = Join-Path $OutDir "steward-$stamp.db"

try {
  Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/admin/backup" `
    -Headers @{ Authorization = "Bearer $Token" } `
    -OutFile $dest -UseBasicParsing -ErrorAction Stop
} catch {
  Write-Error "Backup download failed: $_"
  exit 1
}

$size = (Get-Item $dest).Length
if ($size -lt 4096) {
  # A real SQLite file is never this small — likely an error body. Keep nothing misleading.
  Remove-Item $dest -Force
  Write-Error "Downloaded file too small ($size bytes) - server returned an error instead of a database."
  exit 1
}
Write-Output "Saved $dest ($([math]::Round($size/1KB)) KB)"

# Prune old copies
Get-ChildItem $OutDir -Filter 'steward-*.db' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  ForEach-Object { Remove-Item $_.FullName -Force; Write-Output "Pruned $($_.Name)" }
