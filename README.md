# REFORGE — PC Makeover

A "spa day for your PC." One Windows app that restyles, cleans, and optimizes your
machine in a guided, fully-reversible session — every change can be undone with one click.

Built with **Tauri 2 + Rust + React + TypeScript + Tailwind**.

> Windows only (Windows 10 & 11). See `docs/PC-Makeover-Spec.md` for the technical spec.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/vasilescualex07-droid/Reforge)](https://github.com/vasilescualex07-droid/Reforge/releases)

## Download & install

Grab the latest `Reforge-Setup.exe` from the
[Releases page](https://github.com/vasilescualex07-droid/Reforge/releases) — a per-user
install, no admin rights needed. In-app, Settings → "Check for updates" polls the
same channel and installs newer versions silently.

> **Note:** releases are currently **unsigned**, so Windows may show
> "Unknown publisher" / "Windows protected your PC" on first run. That is
> expected for a new app and fades as download reputation builds
> (see `docs/DELIVERY.md`).

## What's implemented

### Makeover
| Feature | Status |
|---|---|
| **Animated Wallpaper Engine** — 20 procedural scenes (aurora, waves, particles, stars, matrix, embers…) rendered in a borderless window behind your icons; battery-saver auto-pause, freeze-frame, static-wallpaper restore, survives restarts | ✅ |
| **Wallpaper Studio** — template builder (8 scene types) with speed/density/color sliders + live preview | ✅ |
| **Widget Engine** — desktop widgets: clock, live CPU/RAM/disk stats, sticky notes, to-do, calendar (always-on-top, draggable, saved) | ✅ |
| **Theme Studio** — dark/light, accent color, transparency (registry + shell refresh) | ✅ |
| **Style packs & quiz** — 6 curated looks, procedural gradient wallpapers, deterministic 5-question quiz | ✅ |
| **Wallpaper engine (static)** — `SystemParametersInfo` + per-monitor `IDesktopWallpaper` COM | ✅ |
| **Cursor schemes** — apply Aero / Black / system-default with undo | ✅ |

### Tune-up & cleanup
| Feature | Status |
|---|---|
| **Junk cleaner** — dry-run scan, sizes, confirm-before-delete | ✅ |
| **Startup manager** — HKCU/HKLM Run + Startup folder, reversible disable | ✅ |
| **Bloatware uninstaller** — curated scan of pre-installed junk, launches the app's own uninstaller | ✅ |
| **RAM optimizer** — top memory consumers, end process (logged) | ✅ |
| **Registry cleaner** — orphaned uninstall entries, auto-backed-up & revertible | ✅ |
| **Power plan tuner** — list & switch Windows power plans (revertible) | ✅ |
| **Scheduled task auditor** — flags shady auto-start tasks | ✅ |
| **Boot time tracker** — real boot duration from the event log, trended over samples | ✅ |
| **Browser extension auditor** — Chrome/Edge/Brave/Firefox, flags unknown-sourced | ✅ |
| **Default app manager** — reset hijacked file associations (backup + revert) | ✅ |
| **Driver inventory** — pnputil enumeration (read-only) | ✅ |
| **Scheduled maintenance** — one-click junk + duplicate + storage sweep, dated reports | ✅ |

### Organize
| Feature | Status |
|---|---|
| **Duplicate finder** — hash-based, staging trash (reversible), permanent empty | ✅ |
| **Auto-sort** — rule-based filing by type or date, preview-first, reversible | ✅ |
| **Storage visualizer** — top folders by size | ✅ |
| **Smart folders** — dynamic saved searches (extensions + age) that re-run | ✅ |
| **Old file archiver** — zip files untouched N+ months, fully undoable extraction | ✅ |
| **Batch rename** — prefix + counter with preview, reversible | ✅ |
| **Screenshot organizer** — routes screenshots into YYYY/MM folders | ✅ |
| **Downloads auto-expiry** — stale downloads to Recycle Bin (restorable) | ✅ |
| **Unused-app flagging** — apps not updated in 90+ days | ✅ |
| **Cross-cloud duplicate finder** — same file in OneDrive/Dropbox/Drive | ✅ |

### Security
| Feature | Status |
|---|---|
| **Security sweep** — read-only audit: telemetry, startup risk, Wi-Fi, firewall, bloatware | ✅ |
| **Permission auditor** — per-app mic/camera/location with global kill-switch (revertible) | ✅ |
| **Browser privacy hardening** — one-click policies for Chrome/Edge, revertible | ✅ |
| **USB device history** — read-only view of USBSTOR | ✅ |

### Productivity / Network / Gaming / Displays
| Feature | Status |
|---|---|
| **Clipboard manager** — live history, search, pin, clear (local-only) | ✅ |
| **Quick launcher** — every Start-Menu app, one click away | ✅ |
| **Automation macros** — "when app X starts → apply look Y" | ✅ |
| **Focus mode** — hide desktop icons (revertible) | ✅ |
| **Bandwidth hog finder** — active connections by process | ✅ |
| **Saved Wi-Fi cleanup** — forget networks with profile-XML backup + restore | ✅ |
| **One-click network reset** — flush DNS, renew IP, winsock/TCP reset (logged) | ✅ |
| **Game Mode** — registry-backed toggle, revertible | ✅ |
| **Stream-safe layout** — hide icons + auto-hide taskbar for going live | ✅ |
| **Displays** — monitor info, per-monitor wallpapers, display profiles save/apply | ✅ |

### Core & UX
| Feature | Status |
|---|---|
| **Undo system** — granular per-change log, per-entry revert, versioned snapshots, Factory Fresh | ✅ |
| **Makeover History Timeline** — grouped by day, time-stamped sessions | ✅ |
| **Health + Personalization scores**, storage-freed & time-saved counters | ✅ |
| **Dashboard** — quick actions, recent activity, resource hogs | ✅ |
| **Scheduled maintenance / automation** — weekly junk, monthly dupes, auto re-apply theme | ✅ |
| **Blue light filter** — warm gamma ramp, revertible, restored on launch | ✅ |
| **Accessibility** — simplified mode, UI scaling, color-blind palettes | ✅ |
| **Profile export/import** — `.reforge` JSON bundle | ✅ |
| **Command palette** — Ctrl+K search over views & actions | ✅ |
| **Welcome wizard + 20-20-20 break reminders** | ✅ |
| **12 views:** Dashboard, Makeover, Performance, Tune-up, Organize, Security, Productivity, Displays, Network, Gaming, History, Settings | ✅ |

**Not built (needs third-party SDKs / servers / locked-down OS features / media pipelines):**
video/GIF wallpaper files (no codec pipeline), sound scheme editor, font replacer,
taskbar redesigner, lock-screen designer, right-click themer, folder color-coding,
animated screensaver studio, boot/login screen skinning (locked down on Win11),
RGB sync (vendor SDKs), pack marketplace (server), encrypted cloud backup (backend).
These are the honest next milestones.

## Architecture

```
src/                     React + TS + Tailwind UI (Vite)
  lib/api.ts             typed command wrappers; in-browser mock backend for preview
  lib/types.ts           shared types for all 90+ commands
  views/                 12 views (Dashboard, Makeover, Tuneup, Organize, Security,
                         Productivity, Displays, Network, Gaming, Performance, History, Settings)
  components/ui.tsx      shared UI + animated ScenePreview canvases
src-tauri/               Rust backend (Tauri 2)
  src/wallpaper_engine.rs  animated wallpaper window (WebView2 canvas scenes, battery monitor)
  src/widgets.rs           desktop widget windows (clock/stats/note/todo/calendar)
  src/theme.rs             registry-backed personalization + undo logging
  src/wallpaper.rs         SPI + IDesktopWallpaper (per-monitor)
  src/packs.rs             built-in looks + procedural gradient generation (image crate)
  src/cleanup.rs           whitelisted junk targets, dry-run scan, safe clean
  src/startup.rs           Run keys + startup folder, reversible disable
  src/tuneup.rs            bloatware, RAM, registry cleaner, power plans, task audit, boot, extensions, associations
  src/files.rs             smart folders, archiver, rename, screenshots, downloads, cloud dupes
  src/security.rs          audit + permission auditor + browser policies + USB history
  src/productivity.rs      clipboard monitor, launcher, macros, focus mode
  src/network.rs           bandwidth hogs, Wi-Fi backup/forget, network reset
  src/gaming.rs            game mode, stream-safe layout
  src/displays.rs          monitor info + display profiles
  src/automation.rs        schedules + blue-light gamma filter
  src/dashboard.rs         personalization score, storage freed, time saved
  src/undo.rs              granular undo log, versioned snapshots, factory-fresh restore
  src/system.rs            sysinfo aggregation + health score
```

All state (settings, undo log, snapshots, generated wallpapers, clipboard history,
widgets, macros, schedules) lives in the app data directory (`%APPDATA%\com.reforge.app`).
Local-first: nothing leaves the device without explicit opt-in.

## Prerequisites

- [Rust](https://rustup.rs) (stable toolchain, MSVC target)
- MSVC C++ Build Tools + Windows SDK
- Node.js 20+ and npm
- WebView2 runtime (preinstalled on Windows 10/11)

## Build & run

```bash
npm install

# dev (opens the app window):
npm run tauri dev

# or preview the UI in a browser against the mock backend:
npm run dev            # http://localhost:1420

# typecheck + production frontend build:
npm run build

# production exe + installers:
npm run tauri build

# cargo commands need the MSVC environment — run them from a Visual Studio
# developer prompt:
cargo check
cargo test
```

> The Rust backend is only compiled for Windows targets — it uses the `windows` crate,
> registry access, and COM interfaces directly.

## Safety model

- Every mutating command records a revertible undo entry *before* it changes anything.
- Cleanup runs dry-run first; deletion only ever touches whitelisted temp/cache dirs.
- Startup disablement moves values to the undo log (HKCU/HKLM) or a `.reforge_disabled`
  folder, never deletes blindly.
- Registry cleanups and Wi-Fi forgets keep backups that History can restore.
- "Factory Fresh" restores the earliest snapshot captured before a makeover session.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for build instructions, testing, and pull request guidelines.

## License

Released under the [GNU GPL-3.0](LICENSE). See `THIRD_PARTY_NOTICES.md` for the
bundled third-party components.
