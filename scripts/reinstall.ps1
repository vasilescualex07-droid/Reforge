# S1.4 — one-click rebuild + relaunch loop (would have prevented the stale-exe
# incident: exe built at 5:30 AM, fixes landed 10:24 AM-12:20 PM, user was
# still running the old exe).
#
# Kills a running Reforge, rebuilds the release exe, refreshes the desktop
# shortcut, relaunches, then runs the verify gate so you know it's fresh.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/reinstall.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host "==> Stopping any running Reforge..."
Get-Process reforge -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "==> Rebuilding release exe (this takes a while)..."
bash scripts/build-release.sh
if ($LASTEXITCODE -ne 0) { Write-Error "build failed - fix the errors and rerun."; exit 1 }

Write-Host "==> Refreshing desktop shortcut..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/make-desktop-shortcut.ps1

Write-Host "==> Verifying the exe..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-exe.ps1

Write-Host "==> Relaunching..."
$exe = Join-Path $root "src-tauri/target/release/reforge.exe"
if (Test-Path $exe) { Start-Process $exe }

Write-Host "==> Done."
