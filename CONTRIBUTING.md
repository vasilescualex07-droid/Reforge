# Contributing to Reforge

Thanks for wanting to help! Reforge is a Windows-only desktop app built with
**Tauri 2** (Rust backend) + **React + TypeScript** (frontend). These notes
apply to the whole project — code, docs, and tests.

## Quick start

```bash
npm install          # frontend dependencies
npm run tauri dev    # dev mode (opens the app window)
npm run dev          # or preview the UI in a browser against the mock backend
```

### Checks before you commit

```bash
npm run test:ci      # typecheck + lint (0 warnings) + frontend tests + static audits
```

Rust code (run from a Visual Studio developer prompt, or any MSVC-enabled
shell):

```bash
cd src-tauri
cargo test           # Rust unit tests
```

## Reporting bugs

Open an issue using the **bug report** template. Please include:

- Windows version (e.g. Windows 11 23H2)
- Reforge version (Settings → About, or the version tag of the release)
- Steps to reproduce, what you expected, and what actually happened
- Any relevant logs from `%APPDATA%\com.reforge.app`

## Suggesting features

Use the **feature request** template. Describe the *problem* you're solving
rather than just the feature — a short use case goes a long way.

## Pull requests

1. Branch from `main`; keep the change focused (one logical change per PR).
2. Add or update tests. The test suite is the project's safety net — new
   behavior without tests will be sent back.
3. Run `npm run test:ci` (and `cargo test` if Rust is touched) before opening
   the PR.
4. Describe what changed and why in the PR description (template provided).

## Code style

- TypeScript is strict (`tsconfig.json`) — no `any` without a documented reason.
- Frontend components follow the existing patterns in `src/`; `DESIGN.md` and
  `no-slop-standard.md` capture the design system and quality bar.
- Rust follows `cargo fmt` conventions and the existing module layout in
  `src-tauri/src/`.

## License

The project is released under GPL-3.0 (see `LICENSE`). By contributing you
agree that your contributions are licensed under GPL-3.0. Bundled third-party
components are listed in `THIRD_PARTY_NOTICES.md`.
