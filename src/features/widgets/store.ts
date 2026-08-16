// Widget state store — the single source of truth for the hub UI and the
// runtime. Persists through the Rust backend (data_dir/fun_widgets.json via
// the standard storage mechanism — spec §1 "existing Reforge settings
// mechanism"), so toggles and configs survive restarts. Browser preview falls
// back to the mock backend through the same `call` wrapper.
import { call } from "../../lib/api";
import type { FunState } from "./types";

const EMPTY: FunState = { enabled: [], configs: {}, achievements: [], counts: {} };

let state: FunState = { ...EMPTY };
const subs = new Set<() => void>();

function notify() {
  for (const fn of subs) fn();
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getState(): FunState {
  return state;
}

export function isEnabled(id: string): boolean {
  return state.enabled.includes(id);
}

export function enabledCount(): number {
  return state.enabled.length;
}

export async function refresh(): Promise<void> {
  try {
    const s = await call<FunState>("fun_get_state");
    state = s && typeof s === "object" ? s : { ...EMPTY };
  } catch {
    // backend unavailable (fresh browser preview) — stay on empty state
    state = { ...EMPTY };
  }
  notify();
}

export async function setEnabled(id: string, on: boolean): Promise<void> {
  try {
    await call<FunState>("fun_set_enabled", { id, on });
  } catch {
    // propagate to the caller so the hub can surface a real error copy
    throw new Error(`Couldn't ${on ? "enable" : "disable"} this widget.`);
  }
  await refresh();
}

export async function setConfig(id: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await call<FunState>("fun_set_config", { id, patch });
  } catch {
    throw new Error("Couldn't save that setting.");
  }
  await refresh();
}

export async function bumpCount(key: string, n = 1): Promise<number> {
  try {
    const v = await call<number>("fun_bump_count", { key, n });
    state.counts = { ...state.counts, [key]: v };
    return v;
  } catch {
    return 0;
  }
}

export async function unlockAchievement(id: string): Promise<boolean> {
  try {
    const fresh = await call<boolean>("fun_unlock_achievement", { id });
    if (fresh && !state.achievements.includes(id)) {
      state.achievements = [...state.achievements, id];
      notify();
    }
    return fresh;
  } catch {
    return false;
  }
}

export function count(key: string): number {
  return state.counts[key] ?? 0;
}

export function unlocked(id: string): boolean {
  return state.achievements.includes(id);
}
