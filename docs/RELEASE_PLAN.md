# RELEASE PLAN — Going live on GitHub

**Status: IN PROGRESS (2026-08-16).** Owner decisions: public repo on a personal
account, GPL-3.0 license, **ship unsigned for now** (signing deferred — Phase 2).
Phase 0 prep is done (LICENSE, README, workflow fixes, updater URL, branch rename);
Phase 4's per-file checks are green.

This is the S12 go-live plan: push Reforge to GitHub, get a real publisher
signature (no more "Unknown publisher"), and make distribution + auto-updates
flow through GitHub Releases. Most of the machinery already exists and is
committed (`a68ed40` "Land S12 delivery & platform") — this plan activates it,
fixes the gaps, and ships the first release.

---

## Current state (already built, committed)

| Piece | Where | Status |
|---|---|---|
| Release pipeline | `.github/workflows/release.yml` | ✅ exists, never run (repo has no remote) |
| Code-signing script | `scripts/sign-release.ps1` (signtool, skips when no cert) | ✅ exists |
| In-app auto-updater | `src-tauri/src/updater.rs` (curl.exe, sha256-verified, NSIS swap) | ✅ exists, default manifest URL points at `reforge.app` (not ours) |
| SmartScreen reality | `docs/DELIVERY.md` §1 | ✅ honest docs |
| Git history | 10+ milestones, clean tree, 467 tracked files (~392 MB) | ✅ ready |

## Gaps this plan closes

1. **No remote** — repo lives only on disk; branch is `master`, workflow fires on `main`.
2. **Workflow paths** assume the project sits in a `reforge/` subfolder; as the repo root they break.
3. **Updater dead end** — `UpdateConfig::default()` points at `https://reforge.app/releases/latest.json` (a domain we don't own).
4. **Manifest/tag mismatch bug** — the workflow tags releases `v{run_number}` but writes `v{version}` (e.g. `v0.1.0`) into the updater payload URL → updater would 404.
5. **No license** — can't be a real public OSS repo without one.
6. **"Unknown publisher"** — unsigned today; only a real cert fixes the label (self-signed won't — already documented in DELIVERY.md).

---

## Phase 0 — Local prep (me, in-repo)

1. **Decide what ships.** The repo currently tracks internal planning docs
   (`PHASE4_HANDOFF.md`, `Completely_unrelated_prompt_widget.md`, several
   `*_PROMPT.md`, `REFORGE_HISTORICAL_CONTEXT_COMPACT.md`, …). Recommendation:
   keep the README-referenced spec + delivery docs (`docs/PC-Makeover-Spec.md`,
   `docs/DELIVERY.md`), strip pure-internal scratch. — DONE: prompts, handoffs,
   ROADMAPs, and diagnostic scripts were removed before the public push.
2. **Add `LICENSE`** — GNU GPL-3.0 (canonical text from gnu.org). Note in README.
3. **README updates** — "Download" section pointing at GitHub Releases, license
   badge, release badge, short "how updates work" note.
4. **Rename `master` → `main`** (`git branch -m master main`) so the workflow
   trigger (`push: branches: [main]`) matches. Do it before the first push so
   GitHub's default branch is `main`.
5. **Fix workflow for repo-root layout** — drop the `reforge/` prefixes and
   `working-directory: reforge` (→ `./`), fix `cache-dependency-path` and the
   `scripts/sign-release.ps1` reference. Optional hardening: add `cargo test`
   (windows runners have MSVC preinstalled).
6. **Fix the updater wiring** (both sides of the manifest):
   - `src-tauri/src/updater.rs`: default `manifest_url` →
     `https://github.com/<owner>/reforge/releases/latest/download/latest.json`
     (filled in once the repo exists).
   - `release.yml`: make the payload URL **tag-independent** —
     `https://github.com/${{ github.repository }}/releases/latest/download/Reforge-Setup.exe`
     — instead of embedding `v{version}`. Keeps `v{run_number}` tags (unique per
     push, no collisions) and kills the 404 bug.
7. **Verify green locally** before pushing: `npx tsc --noEmit`, `npm test`,
   `scripts/vsenv.sh cargo test`, and one `npm run tauri build` smoke.

## Phase 1 — Create + push the repo (owner + me)

1. Owner creates the repo on GitHub: **`github.com/new`** → name `reforge`,
   **Public**, and create it **empty** (no README/license/.gitignore — the repo
   already has all three; adding GitHub's would conflict on push).
2. First push needs a bigger HTTP buffer for the ~392 MB history:
   `git config http.postBuffer 524288000`, then `git push -u origin main`.
3. Post-push: set repo description/topics, enable Actions (default on), confirm
   `main` is the default branch.

## Phase 2 — Code signing (DEFERRED — ship unsigned for now)

**Status (2026-08-16):** owner decided to ship unsigned and let SmartScreen
reputation build over time (DELIVERY.md §1). Revisit when the label or warning
starts costing installs. Both routes below are drop-in when that happens.

### Option A — SignPath Foundation (free for OSS; takes days)

SignPath Foundation gives free Windows code signing to qualifying OSS projects
([signpath.org](https://signpath.org) — applies when the build runs on
GitHub-hosted runners, which ours does).

1. **Apply** at signpath.org for the Reforge project (repo link, OSS
   confirmation). Approval takes days — start this in parallel with Phase 0/1.
2. In the SignPath dashboard: create the **organization** (this becomes the
   verified publisher name users will see), a **project** for the repo, and a
   **signing policy** for release builds.
3. Generate an **API token** for CI and add repo secrets/vars:
   - Secrets: `SIGNPATH_API_TOKEN`
   - Vars: `SIGNPATH_ORG_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`
4. **I then rework the workflow's sign step** to use
   `signpath/github-action-submit-signing-request@v2` (per
   docs.signpath.io/trusted-build-systems/github):
   - `actions/upload-artifact@v4` with `archive: false` for the exe (+ NSIS/MSI)
   - submit request → wait → download the **signed** artifacts back onto the
     original build paths
   - **order matters**: the updater manifest's sha256 is computed *after*
     signing, so the manifest hashes the signed exe (the current signtool step
     already sits before manifest generation — the SignPath steps take its place).
   - keep `scripts/sign-release.ps1` as the unused fallback for a future paid
     cert (it skips cleanly when unset).

## Phase 3 — Wire the auto-updater to GitHub

1. Set the real manifest URL in `updater.rs` (`Phase 0.6`) once the repo name/owner is known.
2. Update `docs/DELIVERY.md` §1 to describe the SignPath path (it currently only
   documents the "buy a cert → PFX secrets" route).
3. Update `README.md` with the update channel note.

## Phase 4 — First release (me + owner)

1. Tag `v0.1.0` (or trigger the workflow manually) → CI runs typecheck/tests →
   `tauri build` (exe + NSIS + MSI) → manifest generated → **draft release**
   tagged with the version, carrying `reforge.exe`, `Reforge-Setup.exe`,
   `*.msi`, `latest.json`.
2. Owner **publishes the draft** (deliberate manual gate so a bad build never ships).
3. Verify:
   - Installer properties → **Digital Signatures** tab shows the publisher name
     (not "Unknown publisher").
   - `https://github.com/<owner>/reforge/releases/latest/download/latest.json`
     resolves; `.../Reforge-Setup.exe` resolves.
   - In-app "Check for updates" against the live channel returns
     "up-to-date" (version equal) — a later version bump proves the full
     download→verify→stage→install loop.

---

## Risks / honest notes

- **SmartScreen still warns at first.** Even with a real cert, a brand-new
  publisher identity can show "Windows protected your PC" until download
  reputation builds (days–weeks of real installs). What signing *does* fix
  immediately: the publisher name is shown and verified instead of "Unknown
  publisher". EV-style instant trust no longer exists as a product; don't
  promise it.
- **Repo size.** 392 MB tracked (98 MB ffmpeg.exe + 58 wallpaper mp4s). Under
  GitHub's 1 GB soft recommendation and the 100 MB/file hard limit (ffmpeg is
  98.0 MB — no headroom to grow it). If the repo passes ~1 GB, move media to
  Git LFS. First push needs the postBuffer bump (Phase 1.2).
- **Builds on demand.** The workflow triggers on a `v*` tag or manual dispatch
  only — not every push (that used to spawn a 20+ min cold build per commit).
  Publishing the draft is still the go-live action.
- **`latest.json` 404s while the release is a draft.** Expected; the channel
  goes live when the draft is published.
- **SignPath OSS eligibility** requires public repo + GitHub-hosted build. Both
  hold here. If the application is rejected, fall back to buying an OV/IV cert
  (~$200–300/yr) → the existing signtool/PFX-secrets path works unchanged.

---

## Follow-ups (not in this release's critical path)

- GitHub Pages landing page (`<owner>.github.io/reforge`) with a big download
  button + release notes feed.
- `CONTRIBUTING.md` + issue/PR templates.
- Cargo tests in CI (Phase 0.5 optional hardening).
- Version-gated tags (`v0.1.0`) once releases are a settled rhythm — needs the
  trigger to move to tag pushes or the URL scheme to stay `releases/latest/*`
  (which it will).

*Owner action items are marked throughout — everything else I can execute.*
