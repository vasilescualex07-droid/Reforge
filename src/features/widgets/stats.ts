// System-stats snapshot store (spec §3 SYSTEM STATS HOOKS — frontend half).
// The Rust `fun/stats.rs` thread emits `fun:stats` every second while any
// widget is enabled (and nothing at all otherwise — resource hygiene §7).
// Ambient widgets subscribe here; on-demand consumers (Procrastination
// Certificate) call `fetchStatsOnce()` for a guaranteed-fresh snapshot.
import { call, onEvent } from "../../lib/api";
import type { StatsSnapshot } from "./types";

const EMPTY: StatsSnapshot = {
  cpu: 0,
  ram_pct: 0,
  mem_used: 0,
  mem_total: 0,
  disk_pct: 0,
  proc_count: 0,
  uptime_secs: 0,
  idle_secs: 0,
  top_procs: [],
};

let latest: StatsSnapshot = { ...EMPTY };
const subs = new Set<(s: StatsSnapshot) => void>();

function emit() {
  for (const fn of subs) fn(latest);
}

let listening = false;
/** Start the (single) fun:stats subscription. Idempotent. */
export function initStatsListener(): void {
  if (listening) return;
  listening = true;
  onEvent<StatsSnapshot>("fun:stats", (s) => {
    if (s && typeof s.cpu === "number") {
      latest = s;
      emit();
    }
  });
}

export function subscribeStats(fn: (s: StatsSnapshot) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getStats(): StatsSnapshot {
  return latest;
}

/** Force a fresh snapshot from the backend (used by on-demand widgets). */
export async function fetchStatsOnce(): Promise<StatsSnapshot> {
  try {
    const s = await call<StatsSnapshot>("fun_get_stats");
    if (s && typeof s.cpu === "number") {
      latest = s;
      emit();
      return s;
    }
  } catch {
    /* fall through to whatever we have */
  }
  return latest;
}
