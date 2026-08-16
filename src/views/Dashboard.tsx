import { useEffect, useState } from "react";
import { call, fmt, fmtAge } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { DashboardMetrics, HealthScore, SystemInfo, UndoEntry } from "../lib/types";
import { InlineAlert, Meter, ScoreRing, Section, StatCard, StatusDot, toast } from "../components/ui";
import {
  NavMakeover, IconCpu, IconHardDrive, IconClock,
} from "../components/icons";
import { hasResumableSession, loadSession, sessionAgeMinutes } from "../lib/sessionStore";
import type { View } from "../App";

export default function Dashboard({ onNavigate = () => {} }: { onNavigate?: (v: View) => void }) {
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  // S2.2 — state-critical loads through useLoad: one toast per command per
  // session on first failure + a real error surface (InlineAlert) per section.
  const { data: metrics, error: metricsError } = useLoad<DashboardMetrics>("get_dashboard_metrics");
  const { data: recent, error: recentError } = useLoad<UndoEntry[]>("get_undo_log");
  const [resumeAge, setResumeAge] = useState<number | null>(null);

  useEffect(() => {
    if (hasResumableSession()) setResumeAge(sessionAgeMinutes(loadSession()));
  }, []);

  useEffect(() => {
    call<HealthScore>("get_health_score").then(setHealth).catch(() => toast("Could not load health score", "err"));
    call<SystemInfo>("get_system_info").then(setSys).catch(() => toast("Could not load system info", "err"));
  }, []);

  const recentList = (recent ?? []).slice(0, 5);

  const disk = sys?.disks.length ? [...sys.disks].sort((a, b) => a.free_pct - b.free_pct)[0] : null;
  const ramPct = sys ? ((sys.ram_total - sys.ram_used) / sys.ram_total) * 100 : 0;

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Welcome back</h1>
        <p className="page-subtitle">
          {sys ? `${sys.host} · ${sys.os}` : "Loading your PC…"}
        </p>
      </header>

      {/* Health & Personalization side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* PC Health Score — primary card */}
          <Section title="PC Health Score" subtitle="How your machine is feeling today">
            <div className="flex flex-col items-center gap-4">
              <ScoreRing score={health?.score ?? 0} />
              <div className="w-full space-y-2.5">
                {health?.breakdown.map((b) => (
                  <div key={b.label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[var(--text-tertiary)]">{b.label}</span>
                      <span className="text-[var(--text-secondary)]">
                        {b.points}/{b.max}
                      </span>
                    </div>
                    <Meter
                      value={b.points}
                      max={b.max}
                      color={
                        b.points / b.max > 0.6
                          ? "var(--status-success)"
                          : b.points / b.max > 0.3
                            ? "var(--status-warning)"
                            : "var(--status-danger)"
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Personalization Score */}
          <Section title="Personalization Score" subtitle="How much your PC feels like yours">
            {metricsError && <InlineAlert>{metricsError}</InlineAlert>}
            <div className="flex flex-col items-center gap-4">
              <ScoreRing score={metrics?.personalization_score ?? 0} />
              <div className="w-full space-y-1.5">
                {metrics?.active_features.map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                  >
                    <span className="h-1 w-1 rounded-full bg-[var(--status-success)]" />
                    {f}
                  </div>
                ))}
                {(!metrics || metrics.active_features.length === 0) && (
                  <p className="text-center text-xs text-[var(--text-tertiary)]">
                    Head to Makeover and make something yours
                  </p>
                )}
              </div>
            </div>
          </Section>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="RAM free"
            value={sys ? `${ramPct.toFixed(0)}%` : "…"}
            sub={sys ? `${fmt(sys.ram_total - sys.ram_used)} free of ${fmt(sys.ram_total)}` : ""}
            accent={
              ramPct > 40 ? "var(--status-success)" : ramPct > 20 ? "var(--status-warning)" : "var(--status-danger)"
            }
            icon={<IconHardDrive size={14} />}
          />
          <StatCard
            label="CPU load"
            value={sys ? `${sys.cpu_usage_pct.toFixed(1)}%` : "…"}
            sub={sys ? `${sys.cpu_name}` : ""}
            accent={sys && sys.cpu_usage_pct < 60 ? "var(--status-success)" : "var(--status-warning)"}
            icon={<IconCpu size={14} />}
          />
          <StatCard
            label="Lowest disk"
            value={disk ? `${disk.free_pct.toFixed(0)}%` : "…"}
            sub={disk ? `${disk.mount} — ${fmt(disk.free)} free` : ""}
            accent={disk && disk.free_pct > 20 ? "var(--status-success)" : "var(--status-danger)"}
          />
          <StatCard
            label="Startup entries"
            value={health ? String(health.startup_count) : "…"}
            sub="apps launching at boot"
            accent={health && health.startup_count <= 5 ? "var(--status-success)" : "var(--status-warning)"}
          />
          <StatCard
            label="Last cleanup"
            value={health?.last_cleanup_ts ? fmtAge(health.last_cleanup_ts) : "Never"}
            sub="junk & cache"
          />
          <StatCard
            label="Storage freed"
            value={metrics ? fmt(metrics.storage_freed) : "…"}
            sub="junk, duplicates & stale files"
            accent="var(--status-success)"
          />
          <StatCard
            label="Time saved"
            value={metrics ? `${fmtTime(metrics.time_saved_secs)}` : "…"}
            sub={`${metrics?.files_organized ?? 0} files organized`}
            accent="var(--gray-10)"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <Section title="Quick actions">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary btn-sm" onClick={() => onNavigate("makeover")}>
            <NavMakeover size={14} /> {resumeAge !== null ? "Resume makeover" : "Makeover"}
          </button>
          {resumeAge !== null && (
            <span className="self-center text-2xs text-[var(--text-tertiary)]">
              a session is in progress — saved {resumeAge}m ago
            </span>
          )}
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("tuneup")}>
            Scan junk
          </button>
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("history")}>
            <IconClock size={14} /> History
          </button>
          <button className="btn-ghost btn-sm" onClick={() => onNavigate("performance")}>
            Performance
          </button>
        </div>
      </Section>

      {/* Recent Activity */}
      <Section
        title="Recent activity"
        subtitle="Your last makeover moves"
        actions={
          <button
            className="btn-ghost btn-sm shrink-0"
            onClick={() => onNavigate("history")}
          >
            Open timeline
          </button>
        }
      >
        {recentError ? (
          <InlineAlert>{recentError}</InlineAlert>
        ) : recentList.length === 0 ? (
          <div className="empty-state">
            Nothing yet — every change you make is logged here and on the History timeline.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recentList.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-lg bg-[var(--surface-overlay)] px-3 py-2"
              >
                <StatusDot status={e.revertible ? "success" : "info"} />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]" title={e.description}>
                  {e.description}
                </span>
                <span className="shrink-0 text-2xs text-[var(--text-tertiary)]">{fmtAge(e.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Resource Hogs */}
      {sys && (
        <Section title="Resource hogs" subtitle="Top processes by memory">
          <div className="space-y-2">
            {sys.top_processes.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-3 py-2"
              >
                <span className="w-48 truncate text-sm text-[var(--text-primary)]" title={p.name}>{p.name}</span>
                <div className="flex-1">
                  <Meter
                    value={p.mem_mb}
                    max={sys.top_processes[0]?.mem_mb ?? 1}
                    color="var(--gray-10)"
                  />
                </div>
                <span className="w-20 text-right text-xs text-[var(--text-tertiary)]">
                  {fmt(p.mem_mb * 1024 * 1024)}
                </span>
                <span className="w-16 text-right text-2xs text-[var(--text-tertiary)]">
                  {p.cpu_pct.toFixed(1)}% cpu
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* System Vitals */}
      {sys && (
        <Section title="System vitals" subtitle="Quick glance at your machine">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "OS", value: sys.os, sub: sys.host },
              { label: "CPU", value: sys.cpu_name, sub: `${sys.cpu_count} cores` },
              { label: "RAM", value: fmt(sys.ram_total), sub: `${ramPct.toFixed(0)}% free` },
              { label: "Disks", value: `${sys.disks.length} drive${sys.disks.length === 1 ? "" : "s"}`, sub: sys.disks.map((d) => `${d.mount} ${d.free_pct.toFixed(0)}%`).join(", ") },
            ].map((v) => (
              <div key={v.label} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3">
                <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">{v.label}</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]" title={v.value}>{v.value}</div>
                <div className="truncate text-2xs text-[var(--text-tertiary)]" title={v.sub}>{v.sub}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function fmtTime(secs: number): string {
  if (secs >= 3600) return `${(secs / 3600).toFixed(1)} hrs`;
  if (secs >= 60) return `${Math.round(secs / 60)} min`;
  return `${secs}s`;
}
