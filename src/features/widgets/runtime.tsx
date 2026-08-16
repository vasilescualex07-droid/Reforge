// The widgets runtime (resource-hygiene contract, spec §7).
//
// One mount point in App.tsx. Responsibilities:
// - reconcile(): the store is the source of truth. Toggling a widget ON calls
//   its `start` (listeners/overlays); toggling OFF calls the returned stop fn
//   — a real teardown of timers, listeners and overlay windows, never a UI
//   hide. Toggling off the last widget also tells Rust to stop the stats poll.
// - routes global-hotkey events (fun:hotkey) and real completion events
//   (fun:completion → Confetti auto-fire) to the right widget triggers.
// - runs the achievement engine periodically while any widget is enabled.
import { useEffect } from "react";
import { onEvent } from "../../lib/api";
import { checkAchievements } from "./achievements";
import { WIDGETS, getWidget, petReactionFor } from "./registry";
import { ctx, setTriggerFn } from "./runtime-api";
import { initStatsListener } from "./stats";
import { getState, isEnabled, refresh, subscribe } from "./store";

const started = new Map<string, () => void>();
// S7.8 widgets lazy-load on first enable, so their stop fn lands async — two
// reconciles inside that window (store subscribe + refresh catch-up at boot)
// must not start the widget twice and double-spawn its overlay.
const starting = new Set<string>();
let achTimer: number | null = null;
let stopped = false;

function stopWidget(id: string): void {
  const stop = started.get(id);
  if (stop) {
    try {
      stop();
    } catch {
      /* a stop fn must never break the whole teardown */
    }
    started.delete(id);
  }
}

function reconcile(): void {
  const state = getState();
  for (const w of WIDGETS) {
    const on = state.enabled.includes(w.id);
    if (on && w.start && !started.has(w.id) && !starting.has(w.id)) {
      starting.add(w.id);
      const startDone = () => starting.delete(w.id);
      try {
        const r = w.start(ctx);
        // S7.8 — effect modules lazy-load on first enable, so a start can
        // resolve its stop fn asynchronously. If the widget is disabled again
        // before the module lands, stop it immediately instead of leaving it
        // running without a handle.
        if (r && typeof (r as Promise<() => void>).then === "function") {
          (r as Promise<() => void>)
            .then((stop) => {
              startDone();
              if (isEnabled(w.id)) started.set(w.id, stop);
              else stop();
            })
            .catch(() => {
              startDone();
              /* a module that fails to load must not poison the loop */
            });
        } else {
          started.set(w.id, r as () => void);
          startDone();
        }
      } catch {
        startDone();
        /* a widget that fails to start must not poison the loop */
      }
    } else if (!on) {
      stopWidget(w.id);
    }
  }
  // achievement periodic check while ANY widget is enabled (off = no timer)
  if (achTimer !== null) {
    window.clearInterval(achTimer);
    achTimer = null;
  }
  if (state.enabled.length > 0 && !stopped) {
    achTimer = window.setInterval(() => {
      void checkAchievements();
    }, 15000);
  }
}

function trigger(id: string): void {
  const w = getWidget(id);
  if (!w || !isEnabled(id)) return;
  try {
    w.trigger?.(ctx);
  } catch {
    /* a throwing trigger must not break hotkey dispatch */
  }
  petReactionFor(id, isEnabled("pet"));
  void checkAchievements(); // meta-achievements fire immediately, not on the 15s tick
}

/** Restart one widget's listeners after its config changes (hub calls this). */
export function restartWidget(id: string): void {
  const w = getWidget(id);
  if (!w || !w.start || !isEnabled(id)) return;
  stopWidget(id);
  try {
    const r = w.start(ctx);
    if (r && typeof (r as Promise<() => void>).then === "function") {
      (r as Promise<() => void>).then((stop) => {
        if (isEnabled(id)) started.set(id, stop);
        else stop();
      }).catch(() => {
        /* ignore */
      });
    } else {
      started.set(id, r as () => void);
    }
  } catch {
    /* ignore */
  }
}

export function startRuntime(): () => void {
  stopped = false;
  setTriggerFn(trigger);
  initStatsListener();
  const unsubStore = subscribe(reconcile);
  void refresh().then(() => {
    if (!stopped) reconcile();
  });
  const offHotkey = onEvent<{ id: string }>("fun:hotkey", (e) => {
    if (e && typeof e.id === "string") trigger(e.id);
  });
  // Rust surfaces invalid/conflicting hotkey registrations as events
  const offHotkeyErr = onEvent<{ id?: string; reason?: string }>("fun:hotkey-error", (e) => {
    if (e && typeof e.reason === "string") ctx.toast(e.reason, "err");
  });
  const offCompletion = onEvent<{ kind: string }>("fun:completion", () => {
    if (isEnabled("confetti")) trigger("confetti");
    void checkAchievements();
  });
  // catch-up pass after restarts (persisted counters may have crossed lines)
  const bootTimer = window.setTimeout(() => {
    if (!stopped) void checkAchievements();
  }, 3000);
  return () => {
    stopped = true;
    unsubStore();
    offHotkey();
    offHotkeyErr();
    offCompletion();
    window.clearTimeout(bootTimer);
    for (const id of [...started.keys()]) stopWidget(id);
    started.clear();
    if (achTimer !== null) {
      window.clearInterval(achTimer);
      achTimer = null;
    }
  };
}

/** Mounted once in App.tsx — zero DOM, pure orchestration. */
export function WidgetsRuntime() {
  useEffect(() => startRuntime(), []);
  return null;
}
