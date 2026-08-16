// The singleton `WidgetCtx` every widget's behavior functions receive.
// Splitting this out avoids circular imports: widget files import `ctx` here,
// while the runtime wires `trigger` through `setTriggerFn` at boot.
import { toast } from "../../components/ui";
import { closeOverlay, spawnOverlay } from "./overlays";
import { getStats } from "./stats";
import { bumpCount, getState, unlockAchievement } from "./store";
import type { OverlayOpts, WidgetCtx } from "./types";

let triggerFn: (id: string) => void = () => {};

export function setTriggerFn(fn: (id: string) => void): void {
  triggerFn = fn;
}

export const ctx: WidgetCtx = {
  isEnabled: (id) => getState().enabled.includes(id),
  config: (id) => getState().configs[id] ?? {},
  stats: () => getStats(),
  bump: (key, n) => bumpCount(key, n ?? 1),
  toast,
  trigger: (id) => triggerFn(id),
  spawnOverlay: (label: string, html: string, opts: OverlayOpts) => spawnOverlay(label, html, opts),
  closeOverlay: (label: string) => closeOverlay(label),
  unlockAch: (id) => unlockAchievement(id),
};

/** Read a config value with a named-constant default (spec §8: every tunable
 *  threshold is a named constant, discoverable at the top of each widget file). */
export function cfg(id: string, key: string, fallback: number | string | boolean): unknown {
  const c = getState().configs[id];
  const v = c ? c[key] : undefined;
  return v !== undefined && v !== "" ? v : fallback;
}
