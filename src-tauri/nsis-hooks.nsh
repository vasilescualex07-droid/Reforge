; S12.4 — NSIS installer hooks (tauri `bundle.windows.nsis.installerHooks`).
;
; This tauri-build version has no `deleteAppDataOnUninstall` option, so the
; per-user AppData state is removed here instead. The state lives in
; %APPDATA%\com.reforge.app (Roaming\com.reforge.app) — see src-tauri/src/
; storage.rs. Deleting it makes an uninstall a true full cleanup.
;
; The macros are spliced into the generated installer.nsi at the documented
; hook points (NSIS_HOOK_PREINSTALL / POSTINSTALL / PREUNINSTALL /
; POSTUNINSTALL). Only the ones we need are defined.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove the per-user app state (settings, snapshots, wallpapers, updates).
  RMDir /r "$APPDATA\com.reforge.app"
!macroend
