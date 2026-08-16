// Achievement Popper (spec §6). Xbox-style toast sliding in from the bottom-
// right corner: icon + title + description, auto-dismisses after a few
// seconds. When several unlock at once the engine queues them and this host
// shows one at a time (the drain in achievements.ts staggers the next), so
// toasts never stack or overlap. Monochrome-first card with a single accent
// for the icon — per the visual system (§2).
import { useEffect, useState } from "react";
import { getQueue, subscribeQueue, type QueuedAchievement } from "./achievements";

const TOAST_MS = 4500;

export function AchievementToastHost() {
  const [current, setCurrent] = useState<QueuedAchievement | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const unsub = subscribeQueue((q) => {
      const next = q[0] ?? null;
      if (next && next.id !== current?.id) {
        setCurrent(next);
        setLeaving(false);
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          setLeaving(true);
          window.setTimeout(() => setCurrent(null), 260);
        }, TOAST_MS);
      }
    });
    return () => {
      unsub();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [current]);

  if (!current) return null;
  return (
    <div
      data-testid="achievement-toast"
      className={`fixed bottom-6 right-6 z-50 flex w-80 items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 shadow-xl transition-all duration-100 ${
        leaving ? "translate-x-6 opacity-0" : "translate-x-0 opacity-100"
      }`}
      style={{ boxShadow: "var(--shadow-elevation-modal)" }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-selected)] text-xl">
        {current.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-accent)]">
          Achievement unlocked
        </div>
        <div className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">{current.title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{current.desc}</div>
      </div>
    </div>
  );
}

// re-export for tests
export type { QueuedAchievement };
export { getQueue };
