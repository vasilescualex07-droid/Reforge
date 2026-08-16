#!/usr/bin/env node
/**
 * S13.4 — contrast audit.
 *
 * Contract (Win11 a11y baseline):
 *   1. Secondary text ≥ #6B6B6B — the light-mode `--text-tertiary` token must
 *      be at least as dark as #6B6B6B (relative luminance ≤ #6B6B6B's).
 *   2. Accent buttons: `.btn-primary` is white text (#ffffff) on the accent
 *      background (#0067C0) — white-on-blue ≈ 4.8:1, AA for normal text.
 *   3. Focus rings: `:focus-visible` is a 2px outline using `--border-focus`.
 *
 * Usage: node scripts/check-contrast.mjs   (run from the repo root)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");

let errors = 0;
const fail = (msg) => {
  errors++;
  console.error(`CONTRAST  ${msg}`);
};

function relLum(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// 1. light-mode --text-tertiary must be ≥ #6B6B6B (darker or equal luminance).
//    The light-mode :root block precedes the dark-mode override block.
const lightRoot = CSS.slice(0, CSS.indexOf(":root:not([data-theme"));
const mTert = lightRoot.match(/--text-tertiary:\s*(#[0-9a-fA-F]{6})/);
if (!mTert) fail("could not parse light-mode --text-tertiary");
else if (relLum(mTert[1]) > relLum("#6B6B6B") + 1e-9) {
  fail(`light --text-tertiary ${mTert[1]} is lighter than the #6B6B6B floor`);
}

// 2. .btn-primary: white text on the accent background
const mBtn = CSS.match(/\.btn-primary\s*\{([^}]*)\}/);
if (mBtn) {
  const block = mBtn[1];
  const color = block.match(/color:\s*(#[0-9a-fA-F]{6}|white|#fff)/)?.[1];
  const bg = block.match(/background:\s*var\(--accent-hex\)|background:\s*#[0-9a-fA-F]{6}/)?.[0] ?? "";
  if (!color) fail(".btn-primary has no color: (expected white on accent)");
  else if (!/white|#fff|#ffffff/i.test(color)) fail(`.btn-primary text is ${color}, expected white`);
  if (!bg.includes("--accent-hex")) fail(".btn-primary background is not var(--accent-hex)");
} else fail(".btn-primary rule missing");

// 3. 2px focus ring
const mFocus = CSS.match(/:focus-visible\s*\{([^}]*)\}/);
if (mFocus) {
  const outline = mFocus[1].match(/outline:\s*2px\s+[^;]+/)?.[0];
  if (!outline) fail(":focus-visible is not a 2px outline");
  else if (!mFocus[1].includes("--border-focus")) fail(":focus-visible does not use --border-focus");
} else fail(":focus-visible rule missing");

console.log(`\ncheck-contrast: ${errors} contract violations`);
if (errors > 0) {
  console.error("CONTRAST FAIL");
  process.exit(1);
}
console.log("CONTRAST OK");
