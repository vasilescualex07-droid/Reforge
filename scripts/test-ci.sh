#!/usr/bin/env bash
# S1.1 / S13.7 — the full CI gate. Every check that must pass before a build
# ships: typecheck, lint (0 warnings), the whole frontend suite, and the
# static audits: arg/kind parity + the S13 a11y audits (4px grid, clipping,
# focus-visible, contrast). Rust checks run separately (cargo test / clippy —
# see docs/RELEASE_PLAN.md). Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> TypeScript"
npx tsc --noEmit

echo "==> ESLint (0 warnings)"
npm run lint

echo "==> Frontend suite"
npm test

echo "==> Arg parity"
node scripts/check-arg-parity.mjs

echo "==> Kind parity"
node scripts/check-kind-parity.mjs

echo "==> S13.3 4px grid"
node scripts/check-4px-grid.mjs

echo "==> S13.6 clipping sweep"
node scripts/check-clipping.mjs

echo "==> S13.1 focus-visible"
node scripts/check-focus-visible.mjs

echo "==> S13.4 contrast"
node scripts/check-contrast.mjs

echo "==> test:ci ALL GREEN"
