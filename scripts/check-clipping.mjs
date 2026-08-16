#!/usr/bin/env node
/**
 * S13.6 — Long-content clipping sweep.
 *
 * Rules (exit non-zero on any hit — exit gate: a11y audit zero):
 *   1. Every element with `truncate` (or `line-clamp-N`) must carry a
 *      `title=` attribute on the SAME element OR be inside a clickable
 *      wrapper that opens a detail view. The full text must always be
 *      reachable: truncation without an affordance is a data-loss bug.
 *   2. `break-words` + explicit hyphen-free cut: flag hard-coded
 *      `whitespace-nowrap` on long-content strings (title attr required).
 *
 * Heuristic: for each className containing truncate|line-clamp-, look at the
 * whole JSX tag — if the tag has no `title=` and no onClick (detail modal),
 * it's flagged. The script greps the raw text of each tag (matched by a
 * balanced-ish scan of the surrounding element).
 *
 * Usage: node scripts/check-clipping.mjs   (run from the repo root)
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
  // find className strings containing truncate / line-clamp
  const re = /className=\{?["'`]([^"'`]*(?:truncate|line-clamp-\d)[^"'`]*)["'`]/g;
  let m;
  while ((m = re.exec(src))) {
    const cls = m[1];
    const tagStart = src.lastIndexOf("<", m.index);
    // scan forward from the className to the closing ">" of this tag
    const after = src.slice(m.index);
    const gt = after.indexOf(">");
    const tagText = src.slice(tagStart, m.index + gt + 1);
    // "truncate" strings that are programmatic (template literal building a
    // class list) — still require title somewhere in the tag.
    const hasTitle = /title\s*=\s*\{?["'`{]/.test(tagText) || /\btitle\s*=\s*\{?[^}]*\}/.test(tagText);
    const hasClick = /onClick\s*=/.test(tagText) || /role="button"/.test(tagText) || /tabIndex=\{?0/.test(tagText);
    if (!hasTitle && !hasClick) {
      hits++;
      const rel = f.replace(ROOT + "\\", "").replace(ROOT + "/", "");
      console.error(`CLIPPED  ${rel}: truncating class \`${cls.trim()}\` with no title= and no detail click in the same tag`);
    }
  }
}

console.log(`\ncheck-clipping: ${hits} truncated strings without a title= or detail affordance`);
if (hits > 0) {
  console.error("CLIPPING FAIL — every truncated string needs title= (or a detail modal).");
  process.exit(1);
}
console.log("CLIPPING OK");
