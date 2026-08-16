// Style analytics, local (S6.7/E6.8) — applied-style history kept only in
// localStorage. No cloud, no telemetry, no server: the store never leaves
// this PC, and the copy says so. Powers the "Most-used looks" strip and the
// palette insight in the Style Studio.

import type { StyleDef } from "../styles/types";

const KEY = "reforge.style-analytics-v1";
const MAX_ENTRIES = 200;
const MOST_USED_COUNT = 4;
/** An insight needs at least this many applies to say anything honest. */
const MIN_INSIGHT_SAMPLE = 3;
/** A family must dominate this share of looks to claim a preference. */
const DOMINANCE = 0.6;

interface AppliedRecord {
  id: string;
  name: string;
  accentHex: string;
  ts: number;
}

export interface MostUsed {
  id: string;
  name: string;
  count: number;
}

export interface StyleAnalytics {
  /** Most recent first. */
  entries: AppliedRecord[];
  mostUsed: MostUsed[];
  /** Human insight — null when there isn't enough honest data yet. */
  insight: string | null;
}

function readStore(): AppliedRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppliedRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(entries: AppliedRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage unavailable — the strip just won't persist */
  }
}

/** Record an applied style (call once per successful apply_style). */
export function recordStyleApplied(s: StyleDef): void {
  const entries = readStore();
  entries.unshift({ id: s.id, name: s.name, accentHex: s.accent_hex, ts: Date.now() });
  writeStore(entries);
}

export function clearStyleAnalytics(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** [h (0-360), s (0-1)] of a hex accent — warm/cool/neutral classification. */
function classify(hex: string): "warm" | "cool" | "neutral" {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "neutral";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return "neutral";
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  if (sat < 0.18) return "neutral";
  let hue: number;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) hue = ((b - r) / d + 2) * 60;
  else hue = ((r - g) / d + 4) * 60;
  if (hue < 70 || hue >= 330) return "warm";
  return "cool";
}

const FAMILY_LABEL: Record<"warm" | "cool" | "neutral", string> = {
  warm: "warm",
  cool: "cool",
  neutral: "neutral",
};

function buildInsight(entries: AppliedRecord[]): string | null {
  if (entries.length < MIN_INSIGHT_SAMPLE) return null;
  const counts: Record<"warm" | "cool" | "neutral", number> = { warm: 0, cool: 0, neutral: 0 };
  for (const e of entries) counts[classify(e.accentHex)]++;
  const total = entries.length;
  const dominant = (Object.keys(counts) as ("warm" | "cool" | "neutral")[]).reduce((a, b) =>
    counts[b] > counts[a] ? b : a,
  );
  // Claim a preference only when the family both dominates the share AND has
  // enough applies to mean something (2-of-3 is a coin flip, not a pattern).
  if (counts[dominant] >= MIN_INSIGHT_SAMPLE && counts[dominant] / total >= DOMINANCE) {
    const label = FAMILY_LABEL[dominant];
    return `You keep coming back to ${label} palettes — ${counts[dominant]} of your last ${total} looks.`;
  }
  return "Your looks span warm and cool — no strong palette preference yet.";
}

export function getStyleAnalytics(): StyleAnalytics {
  const entries = readStore();
  const byId = new Map<string, { name: string; count: number; lastTs: number }>();
  for (const e of entries) {
    const cur = byId.get(e.id);
    if (cur) {
      cur.count++;
      cur.lastTs = Math.max(cur.lastTs, e.ts);
    } else {
      byId.set(e.id, { name: e.name, count: 1, lastTs: e.ts });
    }
  }
  const mostUsed = [...byId.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].lastTs - a[1].lastTs)
    .slice(0, MOST_USED_COUNT)
    .map(([id, v]) => ({ id, name: v.name, count: v.count }));
  return { entries, mostUsed, insight: buildInsight(entries) };
}
