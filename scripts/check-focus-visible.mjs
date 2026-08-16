#!/usr/bin/env node
/**
 * S13.1 — focus-visible audit.
 *
 * The global `:focus-visible` ring in src/index.css covers every button, a,
 * input, select and textarea. The only way to lose it is to suppress the
 * outline — so this script flags interactive elements whose className
 * contains `outline-none` / `focus:outline-none` and has NO visible focus
 * fallback (`focus:` ring/border style) on the same element.
 *
 * Exempt: elements that replace the outline with a `focus:border-…` /
 * `focus:ring-…` indicator on the same className (text inputs commonly do).
 *
 * Usage: node scripts/check-focus-visible.mjs   (run from the repo root)
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
    } else if (p.endsWith(".tsx") || p.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

let hits = 0;
for (const f of walk(join(ROOT, "src"))) {
  if (f.includes(".test.")) continue;
  const src = readFileSync(f, "utf8");
  // match a JSX tag's className + whether the tag is a button/a/input/select
  const tagRe = /<(button|a|input|select|textarea)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const attrs = m[2];
    const cls = /className=\{?["'`]([^"'`]*)["'`]?\}/.exec(attrs)?.[1] ?? "";
    const suppresses = /\boutline-none\b/.test(cls) || /focus:outline-none/.test(cls);
    if (!suppresses) continue;
    const hasFallback = /focus:(border|ring|outline)[-\w]*(?:-|\[)/.test(cls);
    if (!hasFallback) {
      hits++;
      const rel = f.replace(ROOT + "\\", "").replace(ROOT + "/", "");
      console.error(`NO-FOCUS  ${rel}: <${m[1]}> uses outline-none with no focus fallback in: \`${cls.trim()}\``);
    }
  }
}

console.log(`\ncheck-focus-visible: ${hits} interactive elements with outline suppressed and no focus fallback`);
if (hits > 0) {
  console.error("FOCUS-VISIBLE FAIL — every suppressed outline needs a visible focus: fallback.");
  process.exit(1);
}
console.log("FOCUS-VISIBLE OK");
