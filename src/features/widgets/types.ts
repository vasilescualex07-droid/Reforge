// Shared types for the Widgets feature (spec §8 — self-contained module).
// Mirrors the Rust-side FunStore / Snapshot / OverlayOpts shapes so the
// frontend and backend stay in lockstep (the mock guards this in api.test.ts).

export type WidgetKind = "on-demand" | "ambient" | "persistent";
export type WidgetCategory = "prank" | "celebration" | "ambient" | "utility" | "interactive";

/** Rust `fun_get_state` → FunStore. */
export interface FunState {
  enabled: string[];
  configs: Record<string, Record<string, unknown>>;
  achievements: string[];
  counts: Record<string, number>;
}

/** Rust `fun_get_stats` → Snapshot. */
export interface StatsSnapshot {
  cpu: number;
  ram_pct: number;
  mem_used: number;
  mem_total: number;
  disk_pct: number;
  proc_count: number;
  uptime_secs: number;
  idle_secs: number;
  top_procs: { name: string; cpu: number }[];
}

/** Rust `fun_spawn_overlay` → OverlayOpts. */
export interface OverlayOpts {
  fullscreen?: boolean;
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  w?: number;
  h?: number;
  transparent?: boolean;
  clickable?: boolean;
  /** Steal focus on open — only for interactive payoffs that need keys
   *  (BSOD dismiss, Boss Key cover). Defaults false: payoffs never yank
   *  focus away from real work. */
  focus?: boolean;
  title?: string;
}

/** What a widget's behavior functions receive (built by the runtime). */
export interface WidgetCtx {
  isEnabled(id: string): boolean;
  /** Merged config: defaults ∪ persisted values for `id`. */
  config(id: string): Record<string, unknown>;
  /** Latest stats snapshot (fun:stats tick or one-shot fetch). */
  stats(): StatsSnapshot;
  /** Bump a lifetime counter on the backend. */
  bump(key: string, n?: number): Promise<number>;
  toast(msg: string, kind?: "info" | "err" | "ok"): void;
  /** Trigger another on-demand widget by id (cross-widget cohesion). */
  trigger(id: string): void;
  spawnOverlay(label: string, html: string, opts: OverlayOpts): Promise<void>;
  closeOverlay(label: string): Promise<void>;
  /** Unlock an achievement; resolves true only when newly unlocked. */
  unlockAch(id: string): Promise<boolean>;
}
