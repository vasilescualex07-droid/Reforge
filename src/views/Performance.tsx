import { useEffect, useRef, useState } from "react";
import { call, fmt, swallow } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { BatteryHealth, PerfRecord, PerfSnapshot } from "../lib/types";
import { InlineAlert, Section, StatCard } from "../components/ui";
import { Sparkline, fmtUptime } from "../components/charts";
import { IconCpu, IconBattery, IconHardDrive, IconGauge } from "../components/icons";

const MAX_POINTS = 90;

export default function Performance() {
  const [cpu, setCpu] = useState<number[]>([]);
  const [ram, setRam] = useState<number[]>([]);
  const [snap, setSnap] = useState<PerfSnapshot | null>(null);
  const cpuRef = useRef<number[]>([]);
  const ramRef = useRef<number[]>([]);
  const [rank, setRank] = useState<PerfSnapshot["top_processes"]>([]);
  const [rankBy, setRankBy] = useState<"ram" | "cpu">("ram");
  const [rankError, setRankError] = useState<string | null>(null);
  // S2.2 — battery + history go through useLoad (real error surface). The
  // leaderboard's sort_by changes per click, which useLoad's refresh() can't
  // express (args are deliberately excluded), so it keeps a manual error state.
  const { data: battery, error: batteryError } = useLoad<BatteryHealth>("get_battery_health");
  const { data: history, error: historyError } = useLoad<PerfRecord[]>("get_perf_history");
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let highCpuTicks = 0;
    const tick = async () => {
      if (!alive) return;
      try {
        const s = await call<PerfSnapshot>("get_performance");
        if (!alive) return;
        setSnap(s);
        cpuRef.current = [...cpuRef.current, s.cpu_usage_pct].slice(-MAX_POINTS);
        ramRef.current = [...ramRef.current, s.ram_free_pct].slice(-MAX_POINTS);
        setCpu([...cpuRef.current]);
        setRam([...ramRef.current]);
        if (s.cpu_usage_pct > 85) highCpuTicks += 1;
        else highCpuTicks = Math.max(0, highCpuTicks - 1);
        if (highCpuTicks >= 5) setAlert("CPU has been above 85% for a while — check the resource hogs below.");
        else if (s.ram_free_pct < 15) setAlert("Less than 15% RAM free — consider ending memory hogs from Tune-up.");
        else setAlert(null);
      } catch (e) {
        swallow("get_performance poll", e); /* keep polling */
      }
      // Pause fast polling while the tab is hidden; resume on visibility (C2.2)
      window.setTimeout(tick, document.hidden ? 8000 : 1200);
    };
    tick();
    loadRank("ram");
    return () => {
      alive = false;
    };
  }, []);

  const loadRank = (by: "ram" | "cpu") => {
    setRankBy(by);
    call<PerfSnapshot["top_processes"]>("get_resource_leaderboard", { sort_by: by })
      .then((r) => { setRank(r); setRankError(null); })
      .catch((e) => setRankError(typeof e === "string" ? e : e instanceof Error ? e.message : "Leaderboard unavailable"));
  };

  const maxRank = Math.max(1, ...rank.map((p) => (rankBy === "ram" ? p.mem_mb : p.cpu_pct)));

  const cpuColor = snap && snap.cpu_usage_pct > 80 ? "var(--status-danger)" : snap && snap.cpu_usage_pct > 60 ? "var(--status-warning)" : "var(--status-success)";
  const ramColor = snap && snap.ram_free_pct < 20 ? "var(--status-danger)" : "var(--gray-10)";

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Performance</h1>
        <p className="page-subtitle">
          Live, every 1.2s · uptime {snap ? fmtUptime(snap.uptime_secs) : "…"}
          {snap?.battery && !snap.battery.on_ac && ` · battery ${snap.battery.percent}%`}
        </p>
      </header>

      {alert && (
        <div className="rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm text-[var(--status-warning)]">
          {alert}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="CPU load"
          value={snap ? `${snap.cpu_usage_pct.toFixed(1)}%` : "…"}
          accent={cpuColor}
          sub={`${snap?.process_count ?? 0} processes`}
          icon={<IconCpu size={14} />}
        />
        <StatCard
          label="RAM free"
          value={snap ? `${snap.ram_free_pct.toFixed(0)}%` : "…"}
          accent={ramColor}
          sub={snap ? `${fmt(snap.ram_total - snap.ram_used)} free of ${fmt(snap.ram_total)}` : ""}
          icon={<IconHardDrive size={14} />}
        />
        <StatCard
          label="Battery"
          value={snap?.battery ? `${snap.battery.percent}%` : "No battery"}
          accent="var(--status-success)"
          sub={snap?.battery ? (snap.battery.on_ac ? "on AC" : snap.battery.charging ? "charging" : "on battery") : "desktop PC"}
          icon={<IconBattery size={14} />}
        />
        <StatCard
          label="Booted"
          value={snap ? fmtUptime(snap.uptime_secs) : "…"}
          sub="since last restart"
          icon={<IconGauge size={14} />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="CPU usage" subtitle="Last 90 samples">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-3xl font-bold" style={{ color: cpuColor }}>
              {snap ? `${snap.cpu_usage_pct.toFixed(1)}%` : "…"}
            </span>
          </div>
          <Sparkline data={cpu} color={cpuColor} maxOverride={100} />
        </Section>

        <Section title="RAM free" subtitle="Last 90 samples">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-3xl font-bold" style={{ color: ramColor }}>
              {snap ? `${snap.ram_free_pct.toFixed(1)}%` : "…"}
            </span>
          </div>
          <Sparkline data={ram} color={ramColor} maxOverride={100} />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Disks" subtitle="Free space">
          <div className="space-y-3">
            {snap?.disks.map((d) => (
              <div key={d.mount}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-[var(--text-secondary)]">
                    {d.name} <span className="text-xs text-[var(--text-tertiary)]">{d.mount}</span>
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {fmt(d.free)} free · {d.free_pct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-active)]">
                  <div
                    className="h-full rounded-full transition-all duration-100"
                    style={{
                      width: `${Math.min(100, d.free_pct)}%`,
                      background:
                        d.free_pct > 20 ? "var(--status-success)" : d.free_pct > 10 ? "var(--status-warning)" : "var(--status-danger)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Top processes" subtitle="By memory">
          <div className="space-y-1.5">
            {snap?.top_processes.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-3 rounded-lg bg-[var(--surface-overlay)] px-3 py-1.5 text-sm"
              >
                <span className="w-44 truncate text-[var(--text-secondary)]" title={p.name}>{p.name}</span>
                <div className="flex-1 text-right text-xs text-[var(--text-tertiary)]">
                  {p.cpu_pct.toFixed(1)}% cpu
                </div>
                <span className="w-20 text-right font-medium text-[var(--text-primary)]">
                  {fmt(p.mem_mb * 1024 * 1024)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section
        title="Resource hogs leaderboard"
        subtitle="Every app ranked, not just the top one"
        actions={
          <div className="segment">
            {(["ram", "cpu"] as const).map((m) => (
              <button
                key={m}
                onClick={() => loadRank(m)}
                className={`segment-btn ${rankBy === m ? "active" : ""}`}
              >
                by {m}
              </button>
            ))}
          </div>
        }
      >
        {rankError && <InlineAlert>{rankError}</InlineAlert>}
        <div className="space-y-1.5">
          {rank.map((p, i) => (
            <div key={p.name} className="flex items-center gap-3">
              <span
                className={`w-6 text-right text-xs font-bold ${i < 3 ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`}
              >
                {i + 1}
              </span>
              <span className="w-48 truncate text-sm text-[var(--text-secondary)]" title={p.name}>{p.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-active)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, ((rankBy === "ram" ? p.mem_mb : p.cpu_pct) / maxRank) * 100)}%`,
                    background: i < 3 ? "var(--gray-10)" : "var(--text-tertiary)",
                  }}
                />
              </div>
              <span className="w-24 text-right text-xs text-[var(--text-tertiary)]">
                {rankBy === "ram" ? fmt(p.mem_mb * 1024 * 1024) : `${p.cpu_pct.toFixed(1)}%`}
              </span>
            </div>
          ))}
          {rank.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">Leaderboard unavailable.</p>}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Daily trends" subtitle="CPU load, last 30 days (auto-recorded)">
          {historyError && <InlineAlert>{historyError}</InlineAlert>}
          {(history ?? []).length > 0 ? (
            <div className="flex h-40 items-end gap-[3px]">
              {(history ?? []).slice(-30).map((r, i) => (
                <div key={i} className="group relative flex-1">
                  <div
                    className="w-full rounded-t transition-colors"
                    style={{
                      height: `${Math.max(4, r.cpu_avg)}%`,
                      background: "var(--gray-10)",
                      opacity: 0.6,
                    }}
                    title={`${new Date(r.ts).toLocaleDateString()}: avg ${r.cpu_avg.toFixed(0)}% / max ${r.cpu_max.toFixed(0)}%`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">
              Trend data builds up as you use the app — check back over the coming days.
            </p>
          )}
        </Section>

        <Section title="Battery health" subtitle={battery?.available ? "Cycle count & capacity degradation" : "Not available on this device"}>
          {batteryError && <InlineAlert>{batteryError}</InlineAlert>}
          {battery?.available ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <IconBattery size={32} className="text-[var(--status-success)]" />
                  <span className="absolute text-xs font-bold text-[var(--text-primary)]">
                    {battery.health_pct}%
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="text-[var(--text-secondary)]">
                    Health: <span className="font-medium text-[var(--text-primary)]">{battery.health_pct}%</span>
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    Design: {battery.design_mwh} mWh · Full: {battery.full_mwh} mWh
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {battery.cycle_count} charge cycles
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">Battery health data unavailable — desktop PC or unsupported hardware.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
