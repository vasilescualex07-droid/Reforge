import { useEffect, useState } from "react";
import { errorCopy, call, fmt, fmtDate, swallow } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type {
  AssociationInfo, BloatApp, BootStats, CleanResult, DriverInfo, ExtensionInfo,
  JunkItem, JunkScan, MaintenanceReport, MemHog, OrphanEntry, PowerPlan,
  StartupEntry, TaskInfo,
} from "../lib/types";
import { InlineAlert, Modal, Section, toast } from "../components/ui";
import { onAction } from "../lib/events";
import { IconTrash } from "../components/icons";


type Tab = "junk" | "startup" | "maintenance";

export default function Tuneup() {
  const [tab, setTab] = useState<Tab>("junk");
  const [scan, setScan] = useState<JunkScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [runningMaint, setRunningMaint] = useState(false);

  // ---- power tools ----
  // _hogs/_orphans/_assocs are loaded for upcoming power tools but not yet
  // rendered — kept as local state so the dev-loud shim still populates them.
  const [_hogs, setHogs] = useState<MemHog[]>([]);
  const [_orphans, setOrphans] = useState<OrphanEntry[]>([]);
  const [_assocs, setAssocs] = useState<AssociationInfo[]>([]);
  const [uninstallTarget, setUninstallTarget] = useState<BloatApp | null>(null);

  // S2.2 — the maintenance tools that render real sections go through
  // useLoad: one toast per command per session on first failure, plus a
  // per-card InlineAlert instead of a silent blank.
  const { data: bloat, error: bloatError, refresh: refreshBloat } = useLoad<BloatApp[]>("list_bloatware");
  const { data: plans, error: plansError, refresh: refreshPlans } = useLoad<PowerPlan[]>("list_power_plans");
  const { data: tasks, error: tasksError, refresh: refreshTasks } = useLoad<TaskInfo[]>("audit_scheduled_tasks");
  const { data: boot, error: bootError, refresh: refreshBoot } = useLoad<BootStats>("get_boot_stats");
  const { data: extensions, error: extensionsError, refresh: refreshExtensions } = useLoad<ExtensionInfo[]>("audit_browser_extensions");
  const { data: drivers, error: driversError, refresh: refreshDrivers } = useLoad<DriverInfo[]>("list_drivers");
  const { data: reports, error: reportsError, refresh: refreshReports } = useLoad<MaintenanceReport[]>("list_reports");

  // These three loads don't render a section yet (kept for upcoming power
  // tools) — a failure here is cosmetic, so the dev-loud swallow shim
  // replaces the old silent blank.
  useEffect(() => {
    call<MemHog[]>("get_memory_hogs").then(setHogs).catch((e) => swallow("get_memory_hogs", e));
    call<OrphanEntry[]>("scan_orphaned_entries").then(setOrphans).catch((e) => swallow("scan_orphaned_entries", e));
    call<AssociationInfo[]>("audit_file_associations").then(setAssocs).catch((e) => swallow("audit_file_associations", e));
  }, []);

  useEffect(() => {
    call<StartupEntry[]>("list_startup").then(setStartup).catch(() => toast("Could not load startup entries", "err"));
  }, []);

  const runMaintenance = async () => {
    setRunningMaint(true);
    try {
      const r = await call<MaintenanceReport>("run_maintenance");
      refreshReports();
      toast(`Maintenance complete — ${fmt(r.junk_bytes)} junk found, ${fmt(r.duplicate_bytes)} duplicates`);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setRunningMaint(false);
    }
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const s = await call<JunkScan>("scan_junk");
      setScan(s);
      setSelected(new Set(s.items.filter((i) => !i.admin_required).map((i) => i.id)));
      toast(s.items.length ? `Found ${fmt(s.total_bytes)} of junk` : "Your system is squeaky clean");
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setScanning(false);
    }
  };

  const clean = async () => {
    setCleaning(true);
    try {
      const r = await call<CleanResult>("clean_junk", { ids: [...selected] });
      setConfirmOpen(false);
      if (r.freed_bytes > 0) toast(`Freed ${fmt(r.freed_bytes)} (${r.deleted_count} files)`);
      else toast("Nothing was freed", "info");
      if (r.skipped_admin.length) toast(`Skipped (needs admin): ${r.skipped_admin.join(", ")}`, "info");
      setScan(null);
      setSelected(new Set());
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setCleaning(false);
    }
  };

  const toggleStartup = async (e: StartupEntry) => {
    try {
      const list = await    call<StartupEntry[]>("toggle_startup", {
        name: e.name,
        location: e.location,
        enable: !e.enabled,
      });
      setStartup(list);
      toast(`${e.enabled ? "Disabled" : "Enabled"} ${e.name}`);
    } catch (err) {
      toast(errorCopy(err), "err");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Command palette → real scan (B5)
  useEffect(() => onAction("scan-junk", runScan), []);

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Tune-up</h1>
        <p className="page-subtitle">
          Dry-runs first. Nothing is deleted until you say so.
        </p>
      </header>

      <div className="segment">
        {(["junk", "startup", "maintenance"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`segment-btn ${tab === t ? "active" : ""}`}
          >
            {t === "junk" ? "Junk" : t === "startup" ? "Startup" : "Maintenance"}
          </button>
        ))}
      </div>

      {tab === "junk" && (
        <Section
          title="Junk & cache cleaner"
          subtitle="Temp files, browser caches, crash dumps. Preview first — always."
          actions={
            <button className="btn-primary" onClick={runScan} disabled={scanning}>
              {scanning ? "Scanning…" : "Scan now"}
            </button>
          }
        >
          {!scan && !scanning && (
            <div className="empty-state">Run a scan to see what can be reclaimed.</div>
          )}

          {scanning && (
            <div className="p-8 text-center text-sm text-[var(--text-tertiary)]">
              Scanning… measuring cache sizes.
            </div>
          )}

          {scan && (
            <>
              <div className="mb-4 flex items-center justify-between rounded-xl bg-[var(--gray-3)] px-4 py-3 text-sm">
                <span className="text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">{fmt(scan.total_bytes)}</strong> of junk found across{" "}
                  {scan.items.length} areas
                </span>
                <button
                  className="btn-primary"
                  onClick={() => setConfirmOpen(true)}
                  disabled={selected.size === 0 || cleaning}
                >
                  <IconTrash size={14} /> {cleaning ? "Cleaning…" : `Clean selected (${fmt(selectedBytes(scan, selected))})`}
                </button>
              </div>

              <div className="space-y-2">
                {scan.items.map((item: JunkItem) => (
                  <label
                    key={item.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                      selected.has(item.id)
                        ? "border-[var(--border-accent)] bg-[var(--surface-selected)]"
                        : "border-[var(--border-default)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className=""
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text-primary)]" title={item.label}>
                          {item.label}
                        </span>
                        {item.admin_required && (
                          <span className="badge badge-warning shrink-0">needs admin</span>
                        )}
                      </div>
                      <div className="truncate text-2xs text-[var(--text-tertiary)]" title={item.path}>{item.path}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[var(--text-secondary)]">{fmt(item.size)}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">{item.file_count} files</div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {tab === "startup" && (
        <Section title="Startup manager" subtitle="Apps launching at boot — disable heavy ones to speed up login">
          <div className="space-y-2">
            {startup.map((e) => (
              <div
                key={e.name}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  e.enabled
                    ? "border-[var(--border-default)] bg-[var(--surface-overlay)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface-raised)] opacity-60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{e.name}</span>
                    {e.admin_required && (
                      <span className="badge badge-warning">admin</span>
                    )}
                  </div>
                  <div className="truncate text-2xs text-[var(--text-tertiary)]" title={e.command}>{e.command}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">Location: {e.location}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-[var(--text-tertiary)]">Impact</div>
                    <div
                      className="text-sm font-bold"
                      style={{
                        color:
                          e.impact >= 7
                            ? "var(--status-danger)"
                            : e.impact >= 4
                              ? "var(--status-warning)"
                              : "var(--status-success)",
                      }}
                    >
                      {e.impact}/10
                    </div>
                  </div>
                  <button
                    className={`btn-ghost btn-sm ${e.enabled ? "hover:!text-[var(--status-danger)]" : ""}`}
                    onClick={() => toggleStartup(e)}
                  >
                    {e.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
            {startup.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No startup entries found.</p>}
          </div>
        </Section>
      )}

      {tab === "maintenance" && (
        <Section
          title="System maintenance"
          subtitle="Browser extensions, orphaned entries, power plans, drivers, boot stats"
          actions={
            <button className="btn-primary" onClick={runMaintenance} disabled={runningMaint}>
              {runningMaint ? "Running…" : "Run maintenance"}
            </button>
          }
        >
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Boot Stats */}
            {bootError && <InlineAlert>{bootError}</InlineAlert>}
            {boot?.available && (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
                <div className="text-xs font-medium text-[var(--text-tertiary)]">Boot Time</div>
                <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                  {boot.last_boot_ms ? `${(boot.last_boot_ms / 1000).toFixed(0)}s` : "N/A"}
                </div>
                <div className="text-2xs text-[var(--text-tertiary)]">
                  {boot.samples} samples · trend:{" "}
                  {boot.trend_ms && boot.trend_ms < boot.last_boot_ms! ? "improving" : "stable"}
                </div>
              </div>
            )}

            {/* Bloatware */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
              {bloatError && <InlineAlert>{bloatError}</InlineAlert>}
              <div className="text-xs font-medium text-[var(--text-tertiary)]">Bloatware ({(bloat ?? []).length})</div>
              <div className="mt-2 space-y-1.5">
                {(bloat ?? []).slice(0, 5).map((b) => (
                  <div key={b.name} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">{b.name}</span>
                    <button
                      className="text-2xs text-[var(--status-danger)] hover:underline"
                      onClick={() => setUninstallTarget(b)}
                    >
                      Uninstall
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Power Plans */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
              {plansError && <InlineAlert>{plansError}</InlineAlert>}
              <div className="text-xs font-medium text-[var(--text-tertiary)]">Power Plans</div>
              <div className="mt-2 space-y-1.5">
                {(plans ?? []).map((p) => (
                  <div key={p.guid} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">{p.name}</span>
                    {p.active ? (
                      <span className="badge badge-success">Active</span>
                    ) : (
                      <button
                        className="text-2xs text-[var(--text-secondary)] hover:underline"
                        onClick={() =>
                          call<PowerPlan[]>("set_active_power_plan", { name: p.name, guid: p.guid })
                            .then(() => refreshPlans())
                            .catch((e) => toast(errorCopy(e), "err"))
                        }
                      >
                        Activate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Scheduled Tasks */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
              {tasksError && <InlineAlert>{tasksError}</InlineAlert>}
              <div className="text-xs font-medium text-[var(--text-tertiary)]">Scheduled Tasks ({(tasks ?? []).length})</div>
              <div className="mt-2 space-y-1.5">
                {(tasks ?? []).slice(0, 5).map((t) => (
                  <div key={t.name} className="flex items-center justify-between text-xs">
                    <div className="min-w-0 flex-1">
                      <span className="truncate text-[var(--text-secondary)]" title={t.name}>{t.name}</span>
                      {t.risky && <span className="ml-1 badge badge-danger">risky</span>}
                    </div>
                    <span className="text-2xs text-[var(--text-tertiary)]">{t.trigger}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Drivers */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
              {driversError && <InlineAlert>{driversError}</InlineAlert>}
              <div className="text-xs font-medium text-[var(--text-tertiary)]">Drivers ({(drivers ?? []).length})</div>
              <div className="mt-2 space-y-1.5">
                {(drivers ?? []).map((d) => (
                  <div key={d.name} className="text-xs">
                    <span className="text-[var(--text-secondary)]">{d.provider}</span>
                    <span className="ml-1 text-[var(--text-tertiary)]">v{d.version}</span>
                    <span className="ml-1 text-2xs text-[var(--text-tertiary)]">({d.date})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Browser Extensions */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
              {extensionsError && <InlineAlert>{extensionsError}</InlineAlert>}
              <div className="text-xs font-medium text-[var(--text-tertiary)]">Browser Extensions ({(extensions ?? []).length})</div>
              <div className="mt-2 space-y-1.5">
                {(extensions ?? []).map((e) => (
                  <div key={e.name + e.browser} className="flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[var(--text-secondary)]">{e.name}</span>
                      <span className="ml-1 text-2xs text-[var(--text-tertiary)]">({e.browser})</span>
                      {e.source !== "web store" && <span className="ml-1 badge badge-warning">unknown source</span>}
                    </div>
                    <span className={`badge ${e.enabled ? "badge-success" : "badge-neutral"}`}>
                      {e.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Maintenance Reports */}
          {reportsError && <InlineAlert>{reportsError}</InlineAlert>}
          {(reports ?? []).length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">Recent maintenance runs</div>
              <div className="space-y-2">
                {(reports ?? []).slice(0, 3).map((r, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{fmtDate(r.ts)}</span>
                      <span className="text-[var(--text-tertiary)]">
                        {fmt(r.junk_bytes)} junk · {fmt(r.duplicate_bytes)} dupes
                      </span>
                    </div>
                    {r.notes.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {r.notes.map((n, j) => (
                          <div key={j} className="text-2xs text-[var(--text-tertiary)]">• {n}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <Modal
        open={confirmOpen}
        title={`Clean ${selected.size} items?`}
        onClose={() => setConfirmOpen(false)}
        onConfirm={clean}
        confirmLabel="Clean selected"
        danger
      >
        <p>
          This will delete {fmt(selectedBytes(scan, selected))} of junk files. The action is logged in History but
          individual file restore is not possible — only the full operation can be undone.
        </p>
      </Modal>

      <Modal
        open={!!uninstallTarget}
        title={`Uninstall "${uninstallTarget?.name}"?`}
        onClose={() => setUninstallTarget(null)}
        onConfirm={() => {
          if (uninstallTarget) {
            call("uninstall_bloatware", { name: uninstallTarget.name })
              .then((m) => { toast(m as string); setUninstallTarget(null); refreshBloat(); refreshPlans(); refreshTasks(); refreshBoot(); refreshExtensions(); refreshDrivers(); refreshReports(); })
              .catch((e) => toast(errorCopy(e), "err"));
          }
        }}
        confirmLabel="Uninstall"
        danger
      >
        <p>
          This will launch the uninstaller for <b>{uninstallTarget?.name}</b>. The action is logged in History.
        </p>
      </Modal>
    </div>
  );
}

function selectedBytes(scan: JunkScan | null, selected: Set<string>): number {
  if (!scan) return 0;
  return scan.items.filter((i) => selected.has(i.id)).reduce((a, i) => a + i.size, 0);
}
