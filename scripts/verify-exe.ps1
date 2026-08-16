# S1.3  -  post-build gate for the release exe.
#   1. Every key Tauri command string must be present in the binary (an exe
#      built before a command existed is a lie).
#   2. The exe must be newer than the newest .rs/.ts/.tsx source (stale check).
# Exits non-zero on either failure. Wired as the last step of build-release.sh.
#
# Usage:  powershell -File scripts/verify-exe.ps1
param(
    [string]$Exe = "src-tauri/target/release/reforge.exe"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$exe = Join-Path $root $Exe
$required = @(
    "apply_style",
    "get_applied_style",
    "set_video_wallpaper",
    "list_video_wallpapers",
    "set_animated_wallpaper",
    "get_wallpaper_engine_state",
    "resolve_wallpaper_path",
    "get_build_info"
)

if (-not (Test-Path $exe)) {
    Write-Host "FAIL: no exe at $exe - run scripts/build-release.sh first." -ForegroundColor Red
    exit 1
}

Write-Host "==> Scanning exe for required command strings..."
# grep -a treats the binary as text; this is far faster than a PS byte scan on
# a 300 MB exe. git-bash ships with every Reforge dev setup (build scripts
# already rely on bash).
$missing = @()
foreach ($s in $required) {
    & grep -c -a -- "$s" "$exe" *> $null
    if ($LASTEXITCODE -ne 0) { $missing += $s }
}
if ($missing.Count -gt 0) {
    Write-Host ("FAIL: exe missing command string(s): " + ($missing -join ", ")) -ForegroundColor Red
    exit 1
}

$exeTime = (Get-Item $exe).LastWriteTime
$srcDirs = @((Join-Path $root "src"), (Join-Path $root "src-tauri/src"))
$newest = Get-ChildItem -Path $srcDirs -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".rs", ".ts", ".tsx" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($newest -and $newest.LastWriteTime -gt $exeTime.AddSeconds(5)) {
    Write-Host ("FAIL: exe is STALE - exe {0:yyyy-MM-dd HH:mm} vs newest source {1} ({2:yyyy-MM-dd HH:mm})" -f $exeTime, $newest.Name, $newest.LastWriteTime) -ForegroundColor Red
    exit 1
}

Write-Host ("OK: exe fresh ({0:yyyy-MM-dd HH:mm}) and contains all command strings." -f $exeTime) -ForegroundColor Green
exit 0
