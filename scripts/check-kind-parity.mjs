#!/usr/bin/env node
/**
 * S3.3 / K9 — undo-kind parity check.
 *
 * Re-extracts every kind Rust can write to the undo log:
 *   - literal kinds in `undo::log_entry(&state, "kind", …)` calls,
 *   - dynamic kinds passed to shell's `apply_advanced_dword(…, "kind", …)`,
 *   - kinds referenced in undo.rs's revert match arms.
 *
 * Then diffs against the canonical list in `src/lib/undo-kinds.ts` and the
 * KindChip style set in `src/components/ui.tsx`. Fails on any drift so a new
 * `log_entry("kind", …)` can never ship without a chip style (K9).
 *
 * Usage: node scripts/check-kind-parity.mjs  (from the repo root)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "target" || e === "dist") continue;
      walk(p, out);
    } else if (p.endsWith(".rs")) {
      out.push(p);
    }
  }
  return out;
}

// ---- extract kinds from Rust ----------------------------------------------
const kinds = new Set();
for (const f of walk(join(ROOT, "src-tauri/src"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:undo::)?log_entry\(\s*&?\w+,\s*"([a-z_]+)"/g)) kinds.add(m[1]);
  for (const m of src.matchAll(/apply_advanced_dword\(\s*&?\w+,\s*"[A-Za-z_]+",\s*\w+,\s*"([a-z_]+)"/g)) kinds.add(m[1]);
}
// revert match arms live only in undo.rs (both `"a" | "b"` chains and
// single-arm `match kind.as_str() { "kind" => … }`)
const undo = readFileSync(join(ROOT, "src-tauri/src/undo.rs"), "utf8");
for (const m of undo.matchAll(/"([a-z_]+)"\s*\|\s*"([a-z_]+)"/g)) {
  kinds.add(m[1]);
  kinds.add(m[2]);
}
for (const m of undo.matchAll(/match\s+kind\.as_str\(\)\s*\{(.*?)\n\s*\}/gs)) {
  for (const arm of m[1].matchAll(/^\s*"([a-z_]+)"\s*=>/gm)) kinds.add(arm[1]);
}

// ---- canonical list from the frontend ---------------------------------------
const kindsSrc = readFileSync(join(ROOT, "src/lib/undo-kinds.ts"), "utf8");
// extract only the array literal (comments may mention "kind" in prose, and
// the `readonly string[]` type annotation would break a naive bracket slice)
const arrStart = kindsSrc.indexOf("= [") + 2;
const arrEnd = kindsSrc.indexOf("];", arrStart);
const arr = kindsSrc.slice(arrStart, arrEnd);
const tsList = new Set([...arr.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const uiSrc = readFileSync(join(ROOT, "src/components/ui.tsx"), "utf8");
const chipStart = uiSrc.indexOf("KIND_CHIP_STYLES: Record<string, string> = {");
const chipBlock = uiSrc.slice(chipStart, uiSrc.indexOf("export function KindChip"));
const chipSet = new Set([...chipBlock.matchAll(/^\s*([a-z_]+): "badge/gm)].map((m) => m[1]));

// ---- diff -------------------------------------------------------------------
let errors = 0;
const onlyRust = [...kinds].filter((k) => !tsList.has(k)).sort();
const onlyTs = [...tsList].filter((k) => !kinds.has(k)).sort();
const unstyled = [...kinds].filter((k) => !chipSet.has(k)).sort();
const stale = [...chipSet].filter((k) => !kinds.has(k)).sort();

if (onlyRust.length) {
  errors++;
  console.error("ERROR  kinds logged by Rust but missing from src/lib/undo-kinds.ts:");
  for (const k of onlyRust) console.error(`  - ${k}`);
}
if (onlyTs.length) {
  errors++;
  console.error("ERROR  kinds in src/lib/undo-kinds.ts that Rust never logs:");
  for (const k of onlyTs) console.error(`  - ${k}`);
}
if (unstyled.length) {
  errors++;
  console.error("ERROR  canonical kinds without a KindChip style:");
  for (const k of unstyled) console.error(`  - ${k}`);
}
if (stale.length) {
  errors++;
  console.error("ERROR  KindChip styles with no corresponding kind (stale):");
  for (const k of stale) console.error(`  - ${k}`);
}

console.log(`check-kind-parity: ${kinds.size} rust kinds, ${tsList.size} canonical, ${chipSet.size} chip styles`);
if (errors > 0) {
  console.error("KIND PARITY FAIL — sync src/lib/undo-kinds.ts + KIND_CHIP_STYLES with the Rust sources.");
  process.exit(1);
}
console.log("KIND PARITY OK");
