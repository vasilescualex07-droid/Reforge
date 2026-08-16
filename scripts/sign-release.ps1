# S12.2 — Sign the release artifacts with signtool.exe (Windows SDK).
#
# Dev usage:   powershell -ExecutionPolicy Bypass -File scripts/make-dev-cert.ps1
#              $env:REFORGE_CERT_PFX = "C:\path\dev-cert.pfx"
#              $env:REFORGE_CERT_PASSWORD = "the password you chose"
#              powershell -ExecutionPolicy Bypass -File scripts/sign-release.ps1
#
# CI usage (real OV/EV cert): set the same two env vars from GitHub Secrets
# (see .github/workflows/release.yml) and run this script after `tauri build`.
#
# Signing order matters on Windows: the exe first, then the NSIS installer
# (which embeds the exe). Timestamping is REQUIRED or SmartScreen shows
# "unknown publisher" even for real certs.
$ErrorActionPreference = "Stop"

$pfx = $env:REFORGE_CERT_PFX
$password = $env:REFORGE_CERT_PASSWORD
if (-not $pfx -or -not $password) {
    Write-Host "REFORGE_CERT_PFX / REFORGE_CERT_PASSWORD not set. Skipping signing (unsigned build)." -ForegroundColor Yellow
    exit 0
}

# signtool lives in the Windows SDK; the standard fallback chain is the
# SDK's bin folder. If you installed VS, check vsenv.sh for the canonical path.
$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
    $sdk = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    $candidate = Join-Path $sdk.FullName "x64\signtool.exe"
    if (-not (Test-Path $candidate)) { throw "signtool.exe not found — install the Windows SDK (or run from a VS dev prompt)." }
    $signtool = $candidate
}
$st = $signtool.Source -or $signtool

$root = Split-Path $PSScriptRoot -Parent
$targets = @(
    (Join-Path $root "src-tauri\target\release\reforge.exe"),
    (Join-Path $root "src-tauri\target\release\bundle\nsis\Reforge-Setup.exe"),
    (Join-Path $root "src-tauri\target\release\bundle\msi\Reforge_0.1.0_x64_en-US.msi")
)

foreach ($t in $targets) {
    if (-not (Test-Path $t)) { Write-Host "  (skip, not built: $t)" -ForegroundColor DarkGray; continue }
    Write-Host "==> Signing $t" -ForegroundColor Cyan
    & $signtool sign /f $pfx /p $password /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /v $t
    if ($LASTEXITCODE -ne 0) { throw "signtool failed on $t" }
    & $signtool verify /pa /v $t
}

Write-Host "==> All artifacts signed." -ForegroundColor Green
Write-Host "NOTE: a self-signed dev cert will NOT clear SmartScreen (docs/DELIVERY.md §2)." -ForegroundColor Yellow
