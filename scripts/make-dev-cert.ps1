# S12.2 — Dev self-signed code-signing certificate.
#
# Generates a self-signed code-signing cert (for local signing of test builds
# only — Windows will still flag it with SmartScreen; it is NOT a substitute
# for a real OV/EV cert) and exports it to a PFX that scripts/sign-release.ps1
# can use via REFORGE_CERT_PFX / REFORGE_CERT_PASSWORD.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/make-dev-cert.ps1
#
# Outputs: .\dev-cert.pfx  (password printed at the end — keep it safe)
$ErrorActionPreference = "Stop"

$pfxPath = Join-Path (Split-Path $PSScriptRoot -Parent) "dev-cert.pfx"
$password = Read-Host -AsSecureString "Choose a password for the PFX (you'll need it to sign)"

Write-Host "==> Creating self-signed code-signing certificate (dev only)..." -ForegroundColor Cyan
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Reforge Dev (not for distribution)" `
    -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears(3)

try {
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
    Write-Host "==> Exported: $pfxPath" -ForegroundColor Green
    Write-Host "==> Sign with:"
    Write-Host "    powershell -ExecutionPolicy Bypass -File scripts/sign-release.ps1"
    Write-Host "    (set REFORGE_CERT_PFX / REFORGE_CERT_PASSWORD first)"
    Write-Host ""
    Write-Host "NOTE: a self-signed cert never clears SmartScreen. Use it only to" -ForegroundColor Yellow
    Write-Host "test the signing pipeline; production needs a real OV/EV cert (see docs/DELIVERY.md)." -ForegroundColor Yellow
}
finally {
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
}
