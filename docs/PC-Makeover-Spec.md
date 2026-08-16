# PC Makeover App — Product Spec (Draft v0.1)

> Status: Pre-development plan. Written to be ready for the full implementation prompt.
> Platform: **Windows only** (Windows 10 & 11). Personal tool first; sharing optional later.

---

## 1. Product Overview

A Windows desktop utility with two missions in one app:

1. **Makeover** — restyle the look & feel of Windows (wallpaper, theme, accent color,
   dark/light mode, taskbar, icons, cursors, sounds, lock screen) via one-click
   "look" packs, with live previews and one-click revert.
2. **Tune-up** — clean up and optimize the PC (temp files, junk cleanup, startup
   manager, resource info, safe registry / privacy toggles).

Personal tool first ("make my PC look awesome + run better"). If the pack system
works well, add import/export for sharing packs.

## 2. Guiding Principles

- **Safety first**: every change is reversible. Backup snapshot before any apply;
  one-click full revert.
- **Previews before applying**: see the look before it touches the system.
- **Dry-runs for cleanup**: cleanup shows what it *will* delete before deleting.
- **Windows-native where it matters**: use official Windows APIs, never hacky
  third-party patches (no uxstyle-style DLL injection).
- **Fast & light**: small binary, low RAM, quick startup (desktop app with shortcut).

## 3. Architecture

### 3.1 Shell: Tauri 2 + React + Rust

| Layer | Tech | Why |
|---|---|---|
| Frontend UI | React + TypeScript (Vite) | Fast to build a polished UI; rich preview rendering |
| Backend | Rust (Tauri commands) | Direct Windows API access, small binary, safe |
| Windows API access | `windows` crate (Win32/COM bindings) | Official APIs, no PowerShell string hacks |
| Styling | Tailwind CSS (or similar) | Rapid, consistent theming |
| Build | Tauri bundler | Single portable `.exe` / MSI, NSIS installer |

### 3.2 Process model

- Main window: dashboard with two tabs — **Makeover** and **Tune-up**.
- A **background service/worker** (Tauri sidecar or Rust thread) for long cleanup
  scans and slideshow wallpaper rotation.
- **Elevation**: most personalization is per-user (no admin needed). Only
  system-wide operations (system theme install, boot-level changes) request
  elevation via a clean "Run as admin" flow, and only when required.

### 3.3 Data & persistence

- App settings: JSON at `%APPDATA%\pc-makeover\settings.json`.
- **Snapshot store**: `%APPDATA%\pc-makeover\snapshots\` — a manifest + copies of
  prior settings (registry export, wallpaper paths, current theme, etc.) so any
  applied look can be reverted exactly.
- **Pack files**: a single archive (`.zip`-based, e.g. `.pcmk`) containing:
  - `manifest.json` — pack metadata (name, version, author, description, thumbnail)
  - `wallpaper.*` — image(s)
  - `theme.theme` — Windows theme file (INI) when included
  - `icons/`, `cursors/`, `sounds/` — optional bundled assets
  - `preview.png` — screenshot mockup of the look
- **Pack store (local)**: `%APPDATA%\pc-makeover\packs\` — installed packs.

## 4. Feature Spec

### 4.1 Makeover Engine

**Wallpapers**
- Set wallpaper from local image or built-in gallery
- Per-monitor wallpaper (via `IDesktopWallpaper` COM interface)
- Slideshow / rotation with interval
- Wallpaper sources: local, folder watch, online (Unsplash/Bing) — *later phase*

**Theme & personalization**
- Apply accent color, dark/light mode (registry `HKCU\...\Personalize`)
- Apply `.theme` files (parsed INI) and system theme
- Taskbar styling where supported (transparency, color, position)
- Lock screen image
- Sound scheme swap

**Icon & cursor packs**
- Apply cursor sets (registry `HKCU\Control Panel\Cursors`)
- Icon pack application via desktop icon cache rebuild (careful, risky area)

**"Look" packs (core differentiator)**
- One-click apply of a complete look: wallpaper + accent + mode + taskbar + sounds + cursors
- Snapshot-before-apply; one-click revert
- Pack manager: install, list, delete, export/import

**Preview**
- Mockup canvas: renders a stylized desktop with chosen wallpaper, accent color,
  mode, and taskbar so the user sees the look before applying
- Thumbnails for packs (generated from preview render)

### 4.2 Tune-up Engine

- **Junk cleanup**: temp folders (`%TEMP%`, `C:\Windows\Temp`), recycle bin,
  browser caches, old Windows update leftovers — dry-run first, size display,
  safe-list exclusions
- **Startup manager**: list & toggle startup entries (registry Run keys +
  `shell:startup` folder + Task Scheduler), show impact/risk
- **Disk/space insights**: largest folders/files, space by category
- **Privacy/UX toggles**: telemetry-ish settings, suggested tweaks (with clear
  "what this does" text)
- **System info**: clean display of CPU/RAM/disk/OS/GPU

### 4.3 Safety system (cross-cutting)

- Every destructive or system-mutating action: confirm dialog with clear copy
- Cleanup: dry-run preview list → explicit confirm
- Makeover: auto-snapshot → apply → "Undo" toast with easy restore
- Log file at `%APPDATA%\pc-makeover\logs\` for debugging
- All registry edits scoped to `HKCU` where possible; never delete keys blindly

## 5. Windows API / Integration Inventory

| Capability | API / mechanism |
|---|---|
| Per-monitor wallpaper | `IDesktopWallpaper` (COM) |
| Single wallpaper / basic | `SystemParametersInfo(SPI_SETDESKWALLPAPER)` |
| Accent color, dark/light, taskbar | Registry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` (and `Themes\` for taskbar/transparency) |
| Theme files | Parse/write `.theme` (INI format); `SystemParametersInfo(SPI_SETDESKWALLPAPER)` + notify |
| Lock screen | Registry `HKCU\...\Personalize\LockScreenImage` |
| Cursors | Registry `HKCU\Control Panel\Cursors` + `SystemParametersInfo(SPI_SETCURSORS)` |
| Sounds | Registry `HKCU\AppEvents\Schemes` |
| Startup entries | Registry `HKCU\...\Run`, `HKLM\...\Run`, `shell:startup` folder, Task Scheduler (COM) |
| Temp/junk locations | Known folders + `SHGetKnownFolderPath` |
| OS/hardware info | Win32 APIs (`GetSystemInfo`, `GlobalMemoryStatusEx`, WMI via `windows` crate) |
| Recycle bin | `SHQueryRecycleBin` / `SHEmptyRecycleBin` (with confirm) |
| Elevation | UAC manifest / `ShellExecuteW(runas)` for admin-only ops |

## 6. Data Model Sketch

```jsonc
// settings.json
{
  "version": 1,
  "activeLook": { "packId": "midnight-rain", "appliedAt": "..." },
  "preferences": { "previewQuality": "high", "slideshowIntervalMin": 30 }
}

// pack manifest.json
{
  "id": "midnight-rain",
  "name": "Midnight Rain",
  "version": "1.0.0",
  "author": "me",
  "description": "Dark blue accents, deep wallpaper, rounded taskbar feel",
  "preview": "preview.png",
  "wallpaper": ["wallpaper.jpg"],         // per-monitor list
  "theme": "midnight.theme",              // optional
  "accent": "#4A6CF7",
  "mode": "dark",                          // dark | light | system
  "taskbar": { "transparency": 0.8, "color": "#111827" },
  "cursors": "cursors/",                   // optional dir
  "sounds": "sounds/",                     // optional scheme dir
  "lockScreen": "lock.jpg"                 // optional
}

// snapshot manifest.json
{
  "id": "snap-2026-08-10T12-00-00Z",
  "lookId": "midnight-rain",
  "captured": { "wallpapers": [...], "accent": "...", "mode": "...",
                "themePath": "...", "registryExports": {...} }
}
```

## 7. UI Sketch

```
┌────────────────────────────────────────────────────────────┐
│  PC Makeover                      [Makeover] [Tune-up]     │
├────────────────────────────────────────────────────────────┤
│  ┌ Preview canvas ──────────────┐  ┌ Look packs ─────────┐ │
│  │ (mockup desktop w/ chosen    │  │  ▣ Midnight Rain    │ │
│  │  look; live sliders for      │  │  ▣ Sunset Boulevard │ │
│  │  accent/mode/taskbar)        │  │  ▣ + Import pack    │ │
│  └──────────────────────────────┘  └─────────────────────┘ │
│  [ Apply look ]  [ Undo last change ]                      │
└────────────────────────────────────────────────────────────┘
```

- Makeover tab: preview canvas left, pack gallery right, "Apply"/"Undo" bar bottom.
- Tune-up tab: scan button → results list with sizes + checkboxes → "Clean selected".
- Toast notifications for applied/undone changes.

## 8. Phased Build Plan

**Phase 0 — Scaffold**: Tauri 2 + React + TS project, window opens, settings store,
basic layout (tabs). *(Goal: runnable app skeleton.)*

**Phase 1 — Core makeover**: set wallpaper (single + per-monitor), accent color,
dark/light mode, taskbar transparency. Snapshot + revert for these. *(Goal: first
real "makeover" works end-to-end.)*

**Phase 2 — Look packs**: pack format + manager, one-click apply of combined looks,
preview canvas, import/export. *(Goal: the differentiator works.)*

**Phase 3 — Tune-up**: junk scanner with dry-run, startup manager, disk insights,
safe toggles. *(Goal: cleanup half.)*

**Phase 4 — Polish**: cursors/sounds/lock screen, slideshow, icon packs,
system info, logging, error handling, installer.

**Phase 5 — Sharing (optional)**: pack gallery/import from URL, thumbnails,
versioning. *(Only if the personal tool proves good.)*

## 9. Open Questions / Risks

- Windows 11 vs 10 differences in theming (taskbar transparency is locked down in
  Win11 — may need compromise or third-party tooling; flag early).
- Icon pack changes require icon cache rebuild + Explorer restart — decide if worth it.
- Admin elevation UX: keep per-user scope so most flows never prompt.
- Tauri 2 + `windows` crate: confirm Rust toolchain requirements on the dev machine.
- WebView2 runtime presence on target machines (Tauri requirement).

## 10. Deliverables on First Implementation Pass

1. Scaffolded Tauri 2 + React project in this workspace, runnable via a script.
2. Phase 1 feature set working end-to-end with snapshot/revert.
3. Pack format + manager + preview canvas.
4. Tune-up scanner with dry-run.

## 11. Build Status (2026-08-10)

**Shipped (second pass — 2026-08-10):**
- Live performance dashboard (CPU/RAM SVG graphs, disks, battery, uptime, top processes)
  — Module F core.
- Duplicate finder (hash-based, staging trash) + storage visualizer + reversible
  auto-sort — Modules B & C core.
- Cursor scheme apply (Aero/Black/default) — Module A subset.
- Security sweep (read-only audit: telemetry, startup risk, Wi-Fi, firewall, bloatware)
  — Module E subset.
- Scheduled maintenance reports — Module O core.
- Style match quiz + welcome wizard — Modules G & I.
- Command palette (Ctrl+K) + 20-20-20 break reminders — Modules D & N subsets.
- Profile export/import (.reforge JSON) — Module H.

**Shipped (first pass — Phases 0–3 + part of V2):**
- Tauri 2 + React + TS + Tailwind scaffold — compiles, links, tests green.
- Theme Studio (accent, dark/light, transparency) with registry access + undo logging.
- Wallpaper engine: SPI set/get + `IDesktopWallpaper` per-monitor.
- 6 built-in style packs with procedurally generated gradient wallpapers (2560×1440).
- Junk cleaner (dry-run scan + safe clean of whitelisted dirs) + startup manager
  (HKCU/HKLM Run + startup folder, reversible disable).
- Granular undo log (JSON), snapshots, per-entry revert, Factory Fresh.
- Health score + system info + 5-view UI, verified in browser preview against a mock
  backend and typechecked (`tsc`), frontend built (`vite build`), backend built and
  unit-tested (`cargo build`, `cargo test` — 8 passing).

**Deviations from spec (deliberate):**
- SQLite → JSON files for settings/undo/snapshots (avoids a C compiler dependency in
  the dep tree; storage layer is swappable).
- Cleanup deletes temp/cache files permanently (they are regenerable); user documents
  are never touched.
- Startup disablement stores raw values in the undo log rather than a backup key.

**Shipped (second pass — Phase 2 prompt):**
- Animated Wallpaper Engine: 20 procedural scenes in a borderless always-on-bottom
  WebView2 window (parented to the desktop worker when possible), battery-saver pause,
  freeze-frame, static restore, persistence across restarts + Wallpaper Studio builder.
- Widget Engine: clock/stats/note/todo/calendar desktop widgets (transparent windows,
  live stats push, local auto-save).
- Tune-up: bloatware uninstaller, RAM optimizer, orphaned-registry cleaner, power plan
  tuner, scheduled-task auditor, boot-time tracker, browser-extension auditor, file
  association reset, driver inventory.
- Organize: smart folders, old-file archiver (zip + undoable extract), batch rename,
  screenshot organizer, downloads expiry (Recycle Bin), unused-app flagging,
  cross-cloud duplicate finder.
- Security: permission auditor with kill-switch, browser privacy policies, USB history.
- Productivity: clipboard history monitor, quick launcher, if-then macros (process
  watcher), focus mode. Network: bandwidth hogs, Wi-Fi backup/forget/restore, network
  reset. Gaming: game mode, stream-safe layout. Displays: monitor info + profiles.
- Automation: scheduled maintenance (weekly junk / monthly dupes / theme re-apply),
  blue-light gamma filter (revertible, restored on launch).
- Dashboard: personalization score, storage-freed & time-saved counters, history preview.
- UI: 12 views, history timeline, versioned backups, accessibility (simplified mode,
  scaling, color-blind palettes). ~90 backend commands; cargo build/test + tsc +
  vite build all green; every flow clicked through in the live browser preview.

**Still not built (needs vendor SDKs / servers / media pipelines / locked-down OS):**
video/GIF wallpaper files, sound/font packs, taskbar & lock-screen redesign, context-menu
skinning, screensaver studio, boot/login skinning, RGB sync, marketplace, cloud backup.

**Next milestones:** animated wallpapers, cursor/sound/font packs, widget engine,
performance dashboard graphs, duplicate finder, security sweep, pack import/export.
