#!/usr/bin/env node
/**
 * S3.2 / K8 — Mock↔Rust ↔frontend arg-shape parity check.
 *
 * Parses:
 *   1. every `#[tauri::command]` signature in src-tauri/src (arg names only —
 *      `State<AppState>` / `AppHandle` injection args are skipped),
 *   2. every `case "cmd":` in src/lib/mock.ts and the `args.*` keys it reads,
 *   3. every `call("cmd", { key: … })` / `callWithTimeout` site in src/.
 *
 * Rules (exit code 1 on any ERROR):
 *   - ERROR: the mock reads an arg that doesn't exist in the Rust signature
 *     (the mock would answer a call the real backend would reject with a
 *     different shape — the exact `cfg` vs `config`, `on` vs `enabled` class
 *     of bug K8 exists to catch).
 *   - WARNING: the frontend passes a key the Rust signature doesn't take.
 *     Reported (Rust tolerates unknown keys via serde), because a typo'd key
 *     usually means the intended value never reaches the backend.
 *   - INFO: a Rust arg the mock never reads (usually benign — the mock often
 *     returns canned data without honoring every arg).
 *
 * Usage: node scripts/check-arg-parity.mjs   (run from the repo root)
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
    } else if (p.endsWith(".rs") || p.endsWith(".ts") || p.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

// ---- 1. Rust signatures -----------------------------------------------------
const rust = new Map();
for (const f of walk(join(ROOT, "src-tauri/src"))) {
  const src = readFileSync(f, "utf8");
  const re = /#\[tauri::command\]\s*\n\s*pub fn (\w+)\((.*?)\)\s*(?:->|where|{)/gs;
  let m;
  while ((m = re.exec(src))) {
    const [, name, sig] = m;
    const args = [];
    for (const part of sig.split(",")) {
      const p = part.trim();
      if (!p) continue;
      const mm = /(?:mut )?(\w+)\s*:\s*(.+)$/.exec(p);
      if (mm) {
        const [, aname, atype] = mm;
        if (!atype.includes("State<") && !atype.includes("AppHandle")) args.push(aname);
      }
    }
    rust.set(name, args);
  }
}

// ---- 2. Mock cases ----------------------------------------------------------
const mockSrc = readFileSync(join(ROOT, "src/lib/mock.ts"), "utf8");
const mock = new Map();
const caseRe = /case "([\w]+)":/g;
let cm;
while ((cm = caseRe.exec(mockSrc))) {
  const name = cm[1];
  const rest = mockSrc.slice(cm.index + cm[0].length);
  const next = rest.search(/\n\s*case "[\w]+":/);
  const body = next === -1 ? rest : rest.slice(0, next);
  const read = new Set([...body.matchAll(/args\.(\w+)/g)].map((x) => x[1]));
  mock.set(name, read);
}

// ---- 3. Frontend call sites -------------------------------------------------
const frontend = new Map(); // cmd -> Set(keys)
for (const f of walk(join(ROOT, "src"))) {
  if (f.includes(".test.")) continue;
  const src = readFileSync(f, "utf8");
  const re = /\bcall(?:WithTimeout)?(?:<[^>]*>)?\(\s*"(\w+)"\s*,\s*\{([^}]*)\}/gs;
  let m;
  while ((m = re.exec(src))) {
    const [, cmd, obj] = m;
    if (!rust.has(cmd)) continue;
    if (!frontend.has(cmd)) frontend.set(cmd, new Set());
    // strip one level of nested objects so inner keys (`{ onb: { wizard_seen: true } }`)
    // don't masquerade as top-level arg names (the capture may end mid-brace)
    const top = obj.replace(/\{[^}]*\}?/g, "");
    for (const k of top.matchAll(/(\w+)\s*:/g)) frontend.get(cmd).add(k[1]);
  }
}

// ---- report ---------------------------------------------------------------
let errors = 0;
let warnings = 0;
const infos = [];

for (const [cmd, read] of mock) {
  if (!rust.has(cmd)) continue;
  const rset = new Set(rust.get(cmd));
  for (const a of read) {
    if (!rset.has(a)) {
      errors++;
      console.error(`ERROR  mock reads args.${a} but the Rust signature for \`${cmd}\` has no such arg`);
    }
  }
  for (const a of rust.get(cmd)) {
    if (!read.has(a)) infos.push(`INFO   rust arg \`${a}\` never read by mock: ${cmd}`);
  }
}

for (const [cmd, keys] of frontend) {
  const rset = new Set(rust.get(cmd));
  for (const k of keys) {
    if (!rset.has(k)) {
      warnings++;
      console.warn(`WARN   frontend passes \`${k}\` to ${cmd}, Rust has no such arg (typo? dropped value?)`);
    }
  }
}

console.log(`\ncheck-arg-parity: ${rust.size} rust commands, ${mock.size} mock cases, ${frontend.size} frontend call shapes`);
console.log(`  ${errors} errors, ${warnings} warnings, ${infos.length} info (rust args the mock never reads — usually canned-data benign)`);
if (errors > 0) {
  console.error("PARITY FAIL — fix the errors above (mock must mirror the Rust signature).");
  process.exit(1);
}
if (warnings > 0) {
  console.warn("PARITY WARNINGS — review; the frontend sends keys Rust ignores.");
}
console.log("PARITY OK");
