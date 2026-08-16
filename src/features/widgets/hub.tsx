// Widget Hub (spec §1). The new "Widgets" section in Reforge's nav, following
// the existing Fluent/Mica + dense pro-tool visual system: a grid of 12 cards
// (name, one-line description, on/off toggle, expandable mini-config with
// sensitivity/threshold/hotkey), a Trigger button on on-demand widgets, and an
// achievements panel. Monochrome-first chrome everywhere; individual widget
// PAYOFFS carry their own color (§2).
import { useEffect, useReducer, useState } from "react";
import { errorCopy } from "../../lib/api";
import { InlineAlert, Section, Toggle, toast } from "../../components/ui";
import { IconChevronDown, IconChevronUp, IconCpu, IconStar } from "../../components/icons";
import { ACHIEVEMENTS } from "./achievements";
import { WIDGETS, type ConfigField, type WidgetDef } from "./registry";
import { restartWidget } from "./runtime";
import { ctx } from "./runtime-api";
import { subscribeStats } from "./stats";
import {
  getState,
  isEnabled,
  refresh,
  setConfig,
  setEnabled,
  subscribe,
  unlocked,
} from "./store";
import type { StatsSnapshot } from "./types";

const KIND_LABEL: Record<WidgetDef["kind"], string> = {
  "on-demand": "On-demand",
  ambient: "Ambient",
  persistent: "Persistent",
};

const KIND_STYLE: Record<WidgetDef["kind"], string> = {
  "on-demand": "bg-[var(--surface-selected)] text-[var(--text-accent)]",
  ambient: "bg-[var(--surface-hover)] text-[var(--text-secondary)]",
  persistent: "bg-[var(--surface-hover)] text-[var(--text-secondary)]",
};

function hotkeyHint(k: string): string {
  // normalise for display: ctrl+shift+r → Ctrl+Shift+R
  return k
    .split("+")
    .map((p) => {
      if (p === "ctrl") return "Ctrl";
      if (p === "alt") return "Alt";
      if (p === "shift") return "Shift";
      if (p === "super") return "Win";
      return p.toUpperCase();
    })
    .join("+");
}

function FieldEditor({
  field,
  value,
  onSave,
}: {
  field: ConfigField;
  value: unknown;
  onSave: (key: string, v: unknown) => void;
}) {
  const [draft, setDraft] = useState<string>(() => String(value ?? ""));
  useEffect(() => setDraft(String(value ?? "")), [value]);
  // debounce text/number saves (400ms) so typing doesn't hammer the backend
  useEffect(() => {
    if (field.type === "text" || field.type === "hotkey") {
      const t = window.setTimeout(() => {
        const v = draft.trim();
        if (v !== String(value ?? "")) onSave(field.key, v);
      }, 400);
      return () => window.clearTimeout(t);
    }
    return;
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (field.type === "select") {
    return (
      <select
        className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-hex)]"
        value={String(value ?? "")}
        onChange={(e) => onSave(field.key, e.target.value)}
      >
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "toggle") {
    return (
      <div className="mt-1.5">
        <Toggle on={value === true} onChange={(v) => onSave(field.key, v)} label={field.label} />
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-hex)]"
        min={field.min}
        max={field.max}
        step={field.step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (!Number.isNaN(n)) onSave(field.key, n);
        }}
      />
    );
  }
  if (field.type === "hotkey") {
    return (
      <div>
        <input
          className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-hex)]"
          value={draft}
          placeholder="e.g. ctrl+shift+r"
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Format: <code className="font-mono">ctrl / alt / shift</code> + key. Applies instantly,
          even when Reforge isn't focused.
        </p>
      </div>
    );
  }
  // text
  return (
    <input
      className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-hex)]"
      value={draft}
      placeholder={field.placeholder}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

function WidgetCard({ w }: { w: WidgetDef }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const on = isEnabled(w.id);
  const cfg = getState().configs[w.id] ?? {};

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setEnabled(w.id, !on);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const fire = () => {
    if (!on) return;
    try {
      w.trigger?.(ctx);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const saveField = async (key: string, v: unknown) => {
    try {
      await setConfig(w.id, { [key]: v });
      // thresholds/random-mode live inside listeners — restart to apply
      if (w.start) restartWidget(w.id);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  return (
    <div className="card flex flex-col p-4" data-testid={`widget-card-${w.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="widget-title">{w.name}</h3>
            <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-medium ${KIND_STYLE[w.kind]}`}>
              {KIND_LABEL[w.kind]}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{w.desc}</p>
        </div>
        <Toggle on={on} onChange={() => void toggle()} disabled={busy} label={`${w.name} toggle`} />
      </div>

      {w.kind === "on-demand" && w.triggerLabel && (
        <button
          className="btn btn-primary mt-3 justify-center"
          disabled={!on}
          onClick={fire}
          data-testid={`widget-trigger-${w.id}`}
        >
          {w.triggerLabel}
        </button>
      )}

      {w.fields && w.fields.length > 0 && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
          <button
            className="flex w-full items-center justify-between text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span>Settings</span>
            {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </button>
          {expanded && (
            <div className="mt-2 space-y-3">
              {w.fields.map((f) => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-[var(--text-primary)]">{f.label}</label>
                  <FieldEditor field={f} value={cfg[f.key] ?? w.defaults[f.key]} onSave={(k, v) => void saveField(k, v)} />
                  {f.hint && <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{f.hint}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WidgetsHub() {
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  // store version — bumped on every store notify so derived state (achievement
  // unlocks, hotkeys) recomputes when the backend changes underneath the view
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    let cancelled = false;
    void refresh().then(() => {
      if (!cancelled) setBusy(false);
    });
    const unsubStore = subscribe(() => bump());
    const unsubStats = subscribeStats((s) => setStats(s));
    return () => {
      cancelled = true;
      unsubStore();
      unsubStats();
    };
  }, [bump]);

  const s = getState();
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlocked(a.id)).length;
  const hotkeys = WIDGETS.filter((w) => w.defaults.hotkey && isEnabled(w.id) && s.configs[w.id]?.hotkey)
    .map((w) => ({
      id: w.id,
      key: String(s.configs[w.id]?.hotkey ?? w.defaults.hotkey),
    }));

  return (
    <div>
      <header className="page-head flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Widgets</h1>
          <p className="page-subtitle">
            Optional fun overlays — each one fully stops its listeners and windows when switched off.
          </p>
        </div>
      </header>

      {busy ? (
        <div className="mt-6 space-y-3">
          <div className="skeleton h-8 w-64" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card h-32 p-4" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Live stats strip */}
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-[var(--text-secondary)]">
              <IconCpu size={15} className="text-[var(--status-warning)]" />
              CPU <b className="font-semibold text-[var(--text-primary)]">{Math.round(stats?.cpu ?? 0)}%</b>
            </span>
            <span className="text-[var(--text-secondary)]">
              RAM <b className="font-semibold text-[var(--text-primary)]">{Math.round(stats?.ram_pct ?? 0)}%</b>
            </span>
            <span className="text-[var(--text-secondary)]">
              Processes{" "}
              <b className="font-semibold text-[var(--text-primary)]">{stats?.proc_count ?? "—"}</b>
            </span>
            <span className="text-[var(--text-secondary)]">
              Up <b className="font-semibold text-[var(--text-primary)]">
                {stats && stats.uptime_secs > 0
                  ? `${Math.floor(stats.uptime_secs / 3600)}h ${Math.floor((stats.uptime_secs % 3600) / 60)}m`
                  : "—"}
              </b>
            </span>
            <span className="text-[var(--text-secondary)]">
              Cleanups{" "}
              <b className="font-semibold text-[var(--text-primary)]">{getState().counts.cleanups ?? 0}</b>
            </span>
            <span className="text-[var(--text-secondary)]">
              Force-quits{" "}
              <b className="font-semibold text-[var(--text-primary)]">{getState().counts.force_quits ?? 0}</b>
            </span>
            {hotkeys.length > 0 && (
              <span className="text-[var(--text-tertiary)]">
                Global hotkeys:{" "}
                {hotkeys.map((h) => (
                  <span key={h.id} className="mr-2">
                    <b className="font-mono text-[var(--text-secondary)]">{hotkeyHint(h.key)}</b>{" "}
                    <span className="text-[10px] text-[var(--text-disabled)]">({h.id})</span>
                  </span>
                ))}
              </span>
            )}
          </div>

          <InlineAlert kind="info">
            <span className="text-xs">
              <strong>Off means off.</strong> Disabled widgets run zero background listeners, timers or
              windows — verified by comparing Reforge's own process usage with all 12 on vs. all 12 off.
            </span>
          </InlineAlert>

          {/* Widget grid */}
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {WIDGETS.map((w) => (
              <WidgetCard key={w.id} w={w} />
            ))}
          </div>

          {/* Achievements */}
          <Section
            title="Achievements"
            subtitle={`${unlockedCount} of ${ACHIEVEMENTS.length} unlocked — real stats only, nothing repeats`}
            bare
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ACHIEVEMENTS.map((a) => {
                const have = unlocked(a.id);
                return (
                  <div
                    key={a.id}
                    data-testid={`achievement-${a.id}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      have
                        ? "border-[var(--border-default)] bg-[var(--surface-raised)]"
                        : "border-[var(--border-subtle)] bg-transparent opacity-55"
                    }`}
                  >
                    <span className={`text-lg ${have ? "" : "grayscale"}`}>{have ? a.icon : "🔒"}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                        {a.title}
                        {have && <IconStar size={12} className="text-[var(--status-warning)]" />}
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{a.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
