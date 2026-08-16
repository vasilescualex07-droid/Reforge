$ErrorActionPreference = "SilentlyContinue"
Get-Process reforge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
# Reforge's webview2 tree: any msedgewebview2 whose ancestor chain includes reforge.exe
$refIds = @(Get-Process reforge -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($refIds.Count -eq 0) {
  # reforge is gone; kill webview2 processes whose command line mentions reforge
  Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match "reforge" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} else {
  $wv = Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'"
  foreach ($p in $wv) {
    $cur = $p.ParentProcessId
    while ($cur -ne 0) {
      if ($refIds -contains $cur) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; break }
      $par = Get-CimInstance Win32_Process -Filter "ProcessId = $cur" -ErrorAction SilentlyContinue
      if (-not $par) { break }
      $cur = $par.ParentProcessId
    }
  }
}
Start-Sleep -Seconds 1
"killed"
