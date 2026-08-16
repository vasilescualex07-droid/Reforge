#!/usr/bin/env bash
# Release build for Reforge.
#
# A plain `cargo build --release` does NOT copy bundle resources next to the
# exe  -  so ffmpeg.exe (the video import sidecar) never made it to
# target/release/, and any shortcut-launched build could not find it. This
# script guarantees the sidecar ships next to reforge.exe.
#
# Usage:  bash scripts/build-release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Building frontend (dist/)"
npm run build

echo "==> Building Rust release (this takes a while)"
# S1.2  -  supply the build identity as env vars (build.rs embeds them via
# rerun-if-env-changed, so dev builds don't recompile on every run).
REFORGE_BUILD_TS="$(date +%s)" \
REFORGE_GIT_HASH="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
cargo build --release --manifest-path src-tauri/Cargo.toml

echo "==> Copying ffmpeg sidecar next to the exe"
mkdir -p src-tauri/target/release
cp src-tauri/resources/bin/ffmpeg.exe src-tauri/target/release/ffmpeg.exe

echo "==> Done."
ls -la src-tauri/target/release/reforge.exe src-tauri/target/release/ffmpeg.exe

echo "==> Refreshing desktop shortcut"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/make-desktop-shortcut.ps1 || \
  echo "  (shortcut not refreshed - run scripts/make-desktop-shortcut.ps1 manually)"

echo "==> Verifying the exe (S1.3 stale-binary gate)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-exe.ps1 || \
  echo "  (verify failed - exe may be stale or missing command strings)"
