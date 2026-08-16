#!/usr/bin/env node
/**
 * S13.3 — 4px-grid audit.
 *
 * Greps src/ for spacing utility classes that break the 4px grid and exits
 * non-zero if any are found (exit gate: a11y audit zero).
 *
 * What's flagged:
 *   1. Half-step Tailwind spacing: `0.5 / 1.5 / 2.5 / 3.5` used with any
 *      spacing utility (p, m, px, py, mx, my, mt, mb, ml, mr, gap, space-x,
 *      space-y, inset, top/right/bottom/left, w/h are size not spacing — skip).
 *   2. Arbitrary length values not divisible by 4: `p-[13px]`, `mt-[5px]`,
 *      `gap-[6px]`, `space-y-[7px]`, `top-[3px]`, `left-[10px]` … but NOT
 *      `p-[var(--x)]` (token-driven, fine).
 *
 * Exempt (documented):
 *   - `text-[Npx]` / `text-Npx` — font sizes live on their own scale.
 *   - `rounded-[Npx]` — radii aren't spacing.
 *   - `w-[Npx]` / `h-[Npx]` / `size-[Npx]` — fixed element sizes (e.g. icon
 *     chips), not layout spacing.
 *   - `translate-x/y` offsets are motion, not layout spacing.
 *   - `leading-[Npx]` — line-height, not spacing.
 *
 * Usage: node scripts/check-4px-grid.mjs   (run from the repo root)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "target"].includes(e)) continue;
      walk(p, out);
    } else if (p.endsWith(".tsx") || p.endsWith(".ts") || p.endsWith(".css")) {
      out.push(p);
    }
  }
  return out;
}

// spacing utility prefixes (layout spacing only)
const SPACING = new Set([
  "p", "px", "py", "pt", "pb", "pl", "pr",
  "m", "mx", "my", "mt", "mb", "ml", "mr",
  "gap", "gap-x", "gap-y",
  "space-x", "space-y",
  "top", "right", "bottom", "left", "inset",
]);
const HALF_STEPS = ["0.5", "1.5", "2.5", "3.5"];
const ARBITRARY = /\[(-?\d+(?:\.\d+)?)px\]/;

let hits = 0;
for (const f of walk(join(ROOT, "src"))) {
  if (f.includes(".test.")) continue;
  const src = readFileSync(f, "utf8");
  // tokenize className strings + raw css declarations
  const classRe = /className=\{?["'`]([^"'`]+)["'`]?\}|([a-z-]+):\s*[^;{}]*;/g;
  let m;
  while ((m = classRe.exec(src))) {
    const chunk = m[1] ?? "";
    const cssChunk = m[2] ? `${m[2]}: ${src.slice(m.index + m[0].length).split(";")[0]}` : "";
    const text = chunk || cssChunk;
    for (const tok of text.split(/\s+/)) {
      // p-2.5, gap-1.5, mt-0.5 …
      for (const h of HALF_STEPS) {
        const re = new RegExp(`(^|-)(${[...SPACING].join("|")})-${h}$`);
        if (re.test(tok)) {
          hits++;
          console.error(`OFF-GRID  ${f.replace(ROOT + "\\", "").replace(ROOT + "/", "")}: \`${tok}\` (${h} = ${parseFloat(h) * 4}px, off the 4px grid)`);
        }
      }
      // arbitrary px not divisible by 4
      const am = ARBITRARY.exec(tok);
      if (am) {
        const px = parseFloat(am[1]);
        const prefix = tok.slice(0, tok.indexOf("["));
        if (SPACING.has(prefix) && px % 4 !== 0) {
          hits++;
          console.error(`OFF-GRID  ${f.replace(ROOT + "\\", "").replace(ROOT + "/", "")}: \`${tok}\` (${px}px, off the 4px grid)`);
        }
      }
    }
  }
}

console.log(`\ncheck-4px-grid: ${hits} off-grid spacing hits`);
if (hits > 0) {
  console.error("4PX GRID FAIL — fix the hits above (or document an exemption in the script header).");
  process.exit(1);
}
console.log("4PX GRID OK");
