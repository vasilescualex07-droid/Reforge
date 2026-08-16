# Delivery & Platform — S12

This file records the delivery decisions the roadmap asked
to be **documented, not just implemented**:

1. Code signing + SmartScreen reality (S12.2)
2. Splash → main handoff timing contract (S12.6)
3. Exe size decision (S12.7)

The updater (S12.1), installer UX (S12.4), versioned state + migrations (S12.5)
and the GitHub Actions pipeline (S12.3) are implemented in code — see
`src-tauri/src/updater.rs`, `src-tauri/src/migrations.rs`,
`src-tauri/tauri.conf.json`, `scripts/make-dev-cert.ps1`,
`scripts/sign-release.ps1`, `.github/workflows/release.yml`.

---

## 1. Code signing + SmartScreen (S12.2)

**The honest position:** Reforge is unsigned today. Windows SmartScreen will show
"Windows protected your PC — an unrecognized app is trying to run" on machines
that have not already run the exe. This is expected and documented; the app
never pretends otherwise.

**What clears SmartScreen (only one of these):**

- **Real OV/EV code-signing certificate** (the only full fix). Costs money, takes
  days of identity verification, and the cert must be kept in hardware or CI
  secrets. EV also earns immediate SmartScreen reputation; OV usually needs a
  few thousand downloads to build reputation.
- **Reputation over time.** Even unsigned, a binary that has been downloaded a
  lot on real Windows machines builds SmartScreen reputation and the warning
  fades. This is why `REFORGE_MANIFEST_URL` + the updater matter: shipping
  frequent signed-less updates through one stable exe is better than scattering
  unsigned one-offs.

**What does NOT clear SmartScreen:**

- Self-signed certs (dev only — see below).
- Adding the exe to your own "trusted publishers" store (only helps your machine).
- Renaming, recompressing, or re-hashing the file (SmartScreen tracks content).

### Dev / CI signing pipeline

- `scripts/make-dev-cert.ps1` — generates a self-signed CodeSigningCert and
  exports a PFX. **For local pipeline testing only.** Windows will still flag
  it; it exists so the signing step of the release pipeline is exercised
  end-to-end without spending money.
- `scripts/sign-release.ps1` — signs `reforge.exe`, the NSIS `Reforge-Setup.exe`
  and the MSI with signtool (SHA-256 + RFC3161 timestamp — timestamping is
  mandatory or the signature is treated as untrusted once the cert expires).
  Skips cleanly when `REFORGE_CERT_PFX` / `REFORGE_CERT_PASSWORD` are unset.
- `.github/workflows/release.yml` — reads the same two env vars from GitHub
  Secrets and runs the sign script in CI.

**Production plan (when a real cert is bought):** put the PFX in GitHub Secrets,
flip `REFORGE_CERT_PFX` on, and the release workflow signs everything. Nothing
else in the pipeline changes — the updater's sha256 check is transport-agnostic.

**Status (2026-08-16):** signing is on hold — releases ship **unsigned** for now
and rely on the reputation path above. The PFX route stays drop-in, and the
SignPath Foundation route (free for OSS; `signpath/github-action-submit-signing-request`)
is equally drop-in if that changes. See `docs/RELEASE_PLAN.md`.

---

## 2. Splash → main handoff (S12.6)

The splash is **not a loading screen for a blocked main thread**. The event loop
starts immediately; everything that could block is deferred to a background
thread 1.5 s after setup:

```
t+0.0s   setup(): data dirs, migrations (versioned state), mica, fun-widgets
t+0.0s   background threads spawn (clipboard, macros, engine, rotation, …)
t+1.5s   deferred thread: shell safe-mode fallback → restore plan →
         main-thread restore (engine + widgets + automation state) → splash
t+~2s    deferred thread logs "done in Nms"
```

**Timing contract:** every deferred step logs its elapsed time to
`startup.log` (`deferred startup: begin`, `restoring UI layers on main thread`,
`deferred startup: done in Nms`). A release-build regression shows up as a jump
in that final number — the check is to run the release exe, launch, and read
`%APPDATA%\com.reforge.app\startup.log`; the handoff should complete in the low
single-digit seconds on a cold start, and the main window must be interactive
*before* the deferred thread finishes (that is the point of deferring).

The splash spawns from within the main-thread restore callback, so it always
appears after the persistent layers are back — never on a blank desktop, never
after the user is already looking at the app.

---

## 3. Exe size decision (S12.7)

**Decision: keep the single-file exe; do not externalize media to AppData at
first run. Revisit if the bundled media grows past ~400 MB.**

| Artifact | Size |
|---|---|
| `reforge.exe` (release, Aug 15 build) | 319.6 MB |
| bundled `ffmpeg.exe` sidecar (video import) | 98 MB |
| `resources/` tree (source of the above) | 99 MB |

**Why keep it single-file:**

- **It already works.** The S1.4 reinstall + S4 desktop checklist prove a
  self-contained exe + one sidecar runs from a USB stick with zero setup. That
  is a real product feature for a "PC makeover" tool.
- **First-run extraction is a UX tax.** Downloading 320 MB *then* unpacking it
  to AppData means the first launch after install does heavy disk I/O and the
  app's state is spread across two directories — worse for uninstall (S12.4
  wipes AppData) and for the "local-first, zero install" story.
- **The size is mostly the bundled Rust binary + ffmpeg**, not user media. User
  wallpapers/scenes already live in `%APPDATA%\com.reforge.app\` (versioned
  state, S12.5). The exe is big because it *ships* capabilities, which is
  exactly what a single-file deliverable should do.

**When to revisit:** if engine scenes or bundled packs push the exe past
~400 MB, externalize the largest assets to a first-run `assets/` seed in
AppData and keep a manifest-hash integrity check (the updater's sha256 pattern
reuses cleanly). Until then the size is a deliberate trade for robustness.

**Downside recorded:** 320 MB is a chunky download for the updater (S12.1). The
pipeline mitigates this with delta-friendly versioning (each release is a full
exe, sha256-verified, NSIS-installed silently) — accepted for now.
