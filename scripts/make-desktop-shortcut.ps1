# Creates a desktop shortcut for Reforge pointing at the release exe.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-desktop-shortcut.ps1
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $projectRoot "src-tauri\target\release\reforge.exe"
if (-not (Test-Path $exe)) {
    Write-Error "Release exe not found: $exe`nBuild it first: bash scripts/build-release.sh"
}

# Resolve the real Desktop (handles OneDrive redirection).
$desktop = [Environment]::GetFolderPath("Desktop")
if (-not $desktop) { $desktop = [Environment]::GetFolderPath("DesktopDirectory") }
if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE "Desktop" }
if (-not (Test-Path $desktop)) { New-Item -ItemType Directory -Path $desktop | Out-Null }

$lnk = Join-Path $desktop "Reforge.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = Split-Path -Parent $exe
$shortcut.Description = "Reforge - full Windows PC makeover: themes, wallpapers, security, tune-up and more."
$shortcut.IconLocation = "$exe,0"
$shortcut.Save()

Write-Output "Created: $lnk"
Write-Output "Target : $exe"
