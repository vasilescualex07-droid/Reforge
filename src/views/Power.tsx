// S10.1 — Power & battery view: live battery, battery health (design vs full
// capacity), the active power plan, screen-off timers and hibernate. Every
// change is undoable from History.
import { useState } from "react";
import { errorCopy, call } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { PowerState } from "../lib/types";
import { InlineAlert, Section, StatusDot, Toggle, toast } from "../components/ui";
import { IconBattery, IconGauge, IconMonitor, IconPower } from "../components/icons";

export default function Power() {
  const { data, error, refresh } = useLoad<PowerState>("get_power_state");
  const [busy, setBusy] = useState(false);
  const [acMin, setAcMin] = useState<number | null>(null);
  const [dcMin, setDcMin] = useState<number | null>(null);

  const setPlan = (guid: string) => {
    if (busy) return;
    setBusy(true);
    call("set_power_plan", { guid })
      .then(() => { toast("Power plan changed"); refresh(); })
      .catch((e) => toast(errorCopy(e), "err"))
      .finally(() => setBusy(false));
  };

  const setScreenOff = (ac_min: number, dc_min: number) => {
    if (busy) return;
    setBusy(true);
    call("set_screen_off_timeout", { ac_min, dc_min })
      .then((m) => { toast(String(m)); refresh(); })
      .catch((e) => toast(errorCopy(e), "err"))
      .finally(() => setBusy(false));
  };

  const toggleHibernate = (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    call("set_hibernate", { enabled })
      .then((m) => { toast(String(m)); refresh(); })
      .catch((e) => toast(errorCopy(e), "err"))
      .finally(() => setBusy(false));
  };

  const battery = data?.battery ?? null;
  const health = data?.battery_health ?? null;

  return (
    <div className="space-y-4">
      <div className="page-head">
        <h1 className="page-title">Power & battery</h1>
        <p className="page-subtitle">Plan, screen-off timers and battery health — every change reversible from History</p>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {battery && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Battery" subtitle="Live from the system">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-overlay)] text-[var(--accent-hex)]">
                <IconBattery size={30} />
              </div>
              <div>
                <div className="text-3xl font-bold text-[var(--text-primary)]">{battery.percent}%</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {battery.on_ac ? (battery.charging ? "Charging · on AC" : "On AC") : battery.charging ? "Charging" : "On battery"}
                </div>
              </div>
            </div>
            {health && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2">
                  <div className="text-lg font-bold text-[var(--text-primary)]">{health.health_pct != null ? `${health.health_pct}%` : "—"}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">Health (design vs full)</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2">
                  <div className="text-lg font-bold text-[var(--text-primary)]">{health.cycle_count != null ? health.cycle_count : "—"}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">Cycle count</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2">
                  <div className="text-lg font-bold text-[var(--text-primary)]">{health.full_mwh != null ? Math.round(health.full_mwh / 1000) : "—"} Wh</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">Full capacity</div>
                </div>
              </div>
            )}
          </Section>

          <Section title="Power plan" subtitle="What Windows prioritizes">
            <div className="space-y-2">
              {(data?.plans ?? []).map((p) => (
                <button
                  key={p.guid}
                  onClick={() => setPlan(p.guid)}
                  disabled={busy || p.active}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    p.active
                      ? "border-[var(--status-success-border)] bg-[var(--status-success-bg)]"
                      : "border-[var(--border-default)] bg-[var(--surface-overlay)] hover:border-[var(--border-accent)]"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">{p.name}</div>
                    <div className="text-2xs text-[var(--text-tertiary)]">{p.hint}</div>
                  </div>
                  {p.active && <StatusDot status="success" />}
                </button>
              ))}
            </div>
          </Section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Screen-off timer" subtitle="When the display sleeps while you're away">
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
              On power (minutes)
              <input
                type="number" min={1} max={600}
                value={acMin ?? data?.screen_off_ac_min ?? 10}
                onChange={(e) => setAcMin(Number(e.target.value) || 1)}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
              On battery (minutes)
              <input
                type="number" min={1} max={600}
                value={dcMin ?? data?.screen_off_dc_min ?? 5}
                onChange={(e) => setDcMin(Number(e.target.value) || 1)}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </label>
            <button className="btn-primary" disabled={busy} onClick={() => setScreenOff(acMin ?? data?.screen_off_ac_min ?? 10, dcMin ?? data?.screen_off_dc_min ?? 5)}>
              <IconMonitor size={13} /> Apply
            </button>
          </div>
        </Section>

        <Section title="Hibernate" subtitle="Save RAM to disk for a fast resume">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">Hibernate</div>
              <div className="text-2xs text-[var(--text-tertiary)]">
                {data?.hibernate_supported === false ? "Not available on this system" : "Writes RAM to disk — uses a hibernation file"}
              </div>
            </div>
            <Toggle on={data?.hibernate_enabled ?? false} disabled={!data?.hibernate_supported || busy} onChange={toggleHibernate} />
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-2xs text-[var(--text-tertiary)]">
            <IconPower size={11} /> Toggling needs administrator rights.
          </div>
        </Section>
      </div>

      {!battery && !error && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <IconGauge size={14} /> No battery detected — desktop power settings still apply.
        </div>
      )}
    </div>
  );
}
