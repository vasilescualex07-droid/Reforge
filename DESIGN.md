# Reforge — Design Decisions (written, per Standard A §4)

This file records the deliberate design choices that both governing standards
require to be **stated, not assumed**. Standards in force:

- **Standard A** — `STANDARDS (1).md` (development standards, workspace root)
- **Standard B** — `no-slop-standard.md` (Windows 11 / Fluent detail spec)

## Palette

Reforge uses a **monochrome neutral ramp with a single restrained accent** — the
default both standards prescribe. The accent is **not hardcoded**: at boot the
app reads the real Windows accent (`get_theme_state` → `HKEY_CURRENT_USER\...
\Personalize\AccentColor`) and applies it to the `--accent` / `--accent-hex`
CSS tokens, then re-polls every 5s so a change in Windows Settings shows up
live (Standard B §2). If the registry value is unreadable, the fallback accent
is `#0067C0` (Windows default blue).

No gradients are used in chrome. Gradient *content previews* (wallpaper/style
swatches that render the actual gradient asset) are marked with
`{/* content preview — renders the actual gradient wallpaper */}` so audits
can tell content from decoration.

## Theme behavior

- The app **boots following the OS** theme (`data-theme` on `<html>`, from
  `AppsUseLightTheme`), dark or light, with AA-contrast tokens for each.
- **Theme Studio is the product** — the manual dark/light + accent override is
  the explicitly requested feature and stays (Standard B §2's "no manual
  toggle unless requested" does not apply). Manual overrides flip the same CSS
  tokens the OS boot path sets.
- `prefers-color-scheme` is honored (media-query dark block covers the pre-JS
  paint and browser preview).

## Errors

Every Rust command returns `Result<T, AppError>` (`src-tauri/src/error.rs`),
serialized as a tagged `{ kind, message }` object: `Io`, `Registry`, `Command`,
`NotFound`, `Invalid`. The frontend mirrors this shape (`AppErrorShape` in
`src/lib/types.ts`) and renders copy by shape via `errorCopy()` in
`src/lib/api.ts` — views never string-match error text.

## Capabilities

`capabilities/default.json` is `core:default`. E2 audit (2026-08-12,
re-confirmed after the E1 async pass): the new progress events use the event
bus (`app.emit`), which needs no extra permission, and no command requires
`fs:`/`shell:` plugin permissions — all filesystem work happens inside Rust,
never through Tauri plugins. Commands touching the filesystem, registry, or
PowerShell validate and scope their inputs on the Rust side (see
`security_center::validate_exclusion_target`, `favorites::validate_id`,
`undo::revert_entry` NotFound paths). No telemetry, no network calls except
user-triggered utilities.

## Logging & shell audit (E3)

- Logging goes through a `tracing` subscriber writing to the app-data
  `startup.log` (a direct file write remains in the panic hook as the robust
  fallback). The ad-hoc `append_log` writes are gone.
- Shell audit (`network.rs` + `security_center.rs`): every `netsh` /
  `powershell` / `rasdial` invocation is logged with its args. No caller
  concatenates user input into a shell string — netsh/rasdial calls pass fixed
  arg lists with the profile name as a single argv element (validated:
  non-empty, ≤128 chars, no control chars); PowerShell scripts are fixed
  constants except Defender threat IDs (validated as positive integers) and
  the custom-scan path (control chars and absurd lengths rejected, single
  quotes escaped).
- The two long async offenders (`duplicates::scan_duplicates`, the ffmpeg
  transcode in `transcode.rs`) run on blocking threads and emit
  `scan-progress` / `transcode-progress` events — the UI never freezes during
  a big scan or import.

## Assets

Third-party assets ship with attribution alongside the files:
`THIRD_PARTY_NOTICES.md` (repo root) and `public/wallpapers/ATTRIBUTION.md`.
