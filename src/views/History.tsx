import { useCallback, useEffect, useMemo, useState } from "react";
import { errorCopy, call, fmt, fmtAge } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { MaintenanceReport, Snapshot, UndoEntry } from "../lib/types";
import { InlineAlert, KindChip, Modal, Section, Select, Toggle, toast } from "../components/ui";
import { onAction } from "../lib/events";
import { UNDO_KINDS } from "../lib/undo-kinds";
import { IconUndo, IconClock, IconPlus, IconSearch, IconSparkles } from "../components/icons";

export default function History() {
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [reverting, setReverting] = useState<string | null>(null);
  const [freshOpen, setFreshOpen] = useState(false);
  // S2.2 — snapshots load through useLoad: one toast per session on first
  // failure + an InlineAlert in the backups section instead of a silent blank.
  const { data: snapshots, error: snapshotsError, refresh: refreshSnapshots } = useLoad<Snapshot[]>("list_snapshots");
  // S11.4 — maintenance report cards (weekly audit) live in History too.
  const { data: reports, error: reportsError, refresh: refreshReports } = useLoad<MaintenanceReport[]>("list_reports");
  const [runningMaint, setRunningMaint] = useState(false);

  // ---- S3.12 filters + batch revert ----
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [onlyRevertible, setOnlyRevertible] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batching, setBatching] = useState(false);

  const refresh = useCallback(() => {
    call<UndoEntry[]>("get_undo_log").then(setUndo).catch(() => toast("Could not load history", "err"));
    refreshSnapshots();
  }, [refreshSnapshots]);

  useEffect(refresh, [refresh]);

  // Changing a filter while selecting would leave hidden rows in the count —
  // reset the selection so "Revert N" always matches what's visible.
  useEffect(() => {
    setSelected(new Set());
  }, [query, kindFilter, onlyRevertible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return undo.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (onlyRevertible && !e.revertible) return false;
      if (q && !e.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [undo, query, kindFilter, onlyRevertible]);

  const revert = async (id: string) => {
    setReverting(id);
    try {
      const msg = await call<string>("revert_entry", { id });
      toast(msg);
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setReverting(null);
    }
  };

  // S11.4 — run the full maintenance audit and surface the report card.
  const runMaintenance = async () => {
    setRunningMaint(true);
    try {
      const r = await call<MaintenanceReport>("run_maintenance");
      refreshReports();
      toast(`Maintenance complete — ${fmt(r.junk_bytes)} junk · ${fmt(r.duplicate_bytes)} duplicates`);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setRunningMaint(false);
    }
  };

  const archiveReport = async (ts: number) => {
    try {
      await call<string>("archive_report", { ts });
      toast("Report archived");
      refreshReports();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const snapshot = useCallback(async () => {
    try {
      await call<Snapshot>("snapshot_now");
      toast("Snapshot created — full restore point saved");
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  }, [refresh]);

  // Command palette → real snapshot (B5)
  useEffect(() => onAction("take-snapshot", snapshot), [snapshot]);

  const restoreSnap = async (id: string) => {
    try {
      await call<string>("restore_snapshot", { id });
      toast("Snapshot restored");
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const factoryFresh = async () => {
    try {
      const msg = await call<string>("factory_fresh");
      toast(msg);
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
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

  // Batch revert: one confirm, then each selected entry is reverted through
  // the same revert_entry path (independent entries — partial success is
  // reported honestly per entry, then the list refreshes).
  const batchRevert = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBatching(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await call<string>("revert_entry", { id });
        ok += 1;
      } catch (e) {
        toast(errorCopy(e), "err");
      }
    }
    setBatching(false);
    setBatchOpen(false);
    setSelected(new Set());
    setSelectMode(false);
    refresh();
    if (ok > 0) toast(`Reverted ${ok} change${ok === 1 ? "" : "s"}`);
  };

  const selectableCount = filtered.filter((e) => e.revertible && !e.undone).length;

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">History & Undo</h1>
        <p className="page-subtitle">
          Every change is logged and individually revertible. Nothing is a one-way door.
        </p>
      </header>

      {/* Versioned Backups */}
      <Section
        title="Versioned backups"
        subtitle="Full restore points — keep as many as you like"
        actions={
          <button className="btn-primary" onClick={snapshot}>
            <IconPlus size={14} /> Take snapshot
          </button>
        }
      >
        {snapshotsError && <InlineAlert>{snapshotsError}</InlineAlert>}
        <div className="space-y-2">
          {(snapshots ?? []).length === 0 && !snapshotsError && (
            <div className="empty-state">
              No snapshots yet. Take one before your next makeover.
            </div>
          )}
          {(snapshots ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-overlay)]">
                <IconClock size={16} className="text-[var(--text-tertiary)]" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  Snapshot · {fmtAge(s.ts)}
                </div>
                <div className="text-2xs text-[var(--text-tertiary)]">
                  {new Date(s.ts).toLocaleString()}
                </div>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => restoreSnap(s.id)}>
                <IconUndo size={12} /> Restore
              </button>
            </div>
          ))}
        </div>

        {/* Factory Fresh — danger zone */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-[var(--status-danger)]">Factory Fresh</div>
            <div className="text-xs text-[var(--status-danger)] opacity-70">
              One-click revert to the state captured in your earliest snapshot.
            </div>
          </div>
          <button className="btn-danger" onClick={() => setFreshOpen(true)}>
            Revert everything
          </button>
        </div>
      </Section>

      {/* S11.4 — Maintenance reports */}
      <Section
        title="Maintenance reports"
        subtitle="Weekly junk / duplicate / startup audits — generate, review, archive"
        actions={
          <button className="btn-primary" onClick={runMaintenance} disabled={runningMaint}>
            {runningMaint ? "Running…" : "Run maintenance"}
          </button>
        }
      >
        {reportsError && <InlineAlert>{reportsError}</InlineAlert>}
        {(reports ?? []).length === 0 && !reportsError && (
          <div className="empty-state">
            No maintenance reports yet. Run one to see how much junk, duplicates and startup bloat are hiding on this PC.
          </div>
        )}
        {(reports ?? []).length > 0 && (
          <div className="space-y-2">
            {(reports ?? []).map((r) => (
              <div
                key={r.ts}
                className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-overlay)]">
                  <IconSparkles size={16} className="text-[var(--text-tertiary)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-sm font-medium text-[var(--text-primary)]">Audit · {fmtAge(r.ts)}</span>
                    <span className="text-2xs text-[var(--text-tertiary)]">{new Date(r.ts).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-2xs">
                    <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-[var(--text-secondary)]">{fmt(r.junk_bytes)} junk ({r.junk_items} areas)</span>
                    <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-[var(--text-secondary)]">{fmt(r.duplicate_bytes)} duplicates ({r.duplicate_files} groups)</span>
                    {r.startup_heavy > 0 && (
                      <span className="rounded bg-[var(--status-warning-bg)] px-2 py-0.5 text-[var(--status-warning)]">{r.startup_heavy} heavy startup entr{r.startup_heavy === 1 ? "y" : "ies"}</span>
                    )}
                  </div>
                  {r.notes.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {r.notes.map((n, j) => (
                        <div key={j} className="text-2xs text-[var(--text-tertiary)]">• {n}</div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => archiveReport(r.ts)}
                  title="Move this report out of the active list"
                >
                  Archive
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-2xs text-[var(--text-tertiary)]">
          Reports are generated locally and never leave this PC. Archiving removes a report from this list (kept on disk in the archive folder).
        </p>
      </Section>

      {/* Timeline */}
      <Section
        title="Makeover History Timeline"
        subtitle="Your sessions, grouped by day — each row reverts on its own"
        actions={
          selectMode ? (
            <button className="btn-ghost" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>
              Done selecting
            </button>
          ) : (
            <button className="btn-ghost" onClick={() => setSelectMode(true)} disabled={undo.length === 0}>
              Select to batch revert
            </button>
          )
        }
      >
        {/* S3.12 — filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-52">
            <IconSearch size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              className="input pl-8"
              placeholder="Search descriptions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search history descriptions"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-wide text-[var(--text-tertiary)]">Kind</span>
            <Select
              ariaLabel="Filter by change kind"
              value={kindFilter}
              onChange={setKindFilter}
              options={[{ value: "all", label: "All kinds" }, ...UNDO_KINDS.map((k) => ({ value: k, label: k.replace(/_/g, " ") }))]}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-wide text-[var(--text-tertiary)]">Reversible only</span>
            <Toggle on={onlyRevertible} onChange={setOnlyRevertible} label="Only show reversible changes" />
          </div>
          {selectMode && selected.size > 0 && (
            <button className="btn-danger" onClick={() => setBatchOpen(true)} disabled={batching}>
              Revert {selected.size} selected
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            {undo.length === 0
              ? "Nothing logged yet. Changes from the Makeover and Tune-up tabs will appear here."
              : "No changes match the current filters."}
          </div>
        ) : (
          <div className="space-y-5">
            {groupByDay(filtered).map(([day, entries]) => (
              <div key={day}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    {day}
                  </span>
                  <span className="h-px flex-1 bg-[var(--border-subtle)]" />
                  <span className="text-2xs text-[var(--text-tertiary)]">
                    {entries.length} change{entries.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-2">
                  {entries.map((e) => {
                    const checkable = e.revertible && !e.undone;
                    const checked = selected.has(e.id);
                    return (
                      <div
                        key={e.id}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                          selectMode && checked
                            ? "border-[var(--border-accent)] bg-[var(--surface-selected)]"
                            : e.undone
                              ? "border-[var(--border-subtle)] bg-[var(--surface-raised)] opacity-50"
                              : "border-[var(--border-default)] bg-[var(--surface-overlay)]"
                        }`}
                      >
                        {selectMode && (
                          <input
                            type="checkbox"
                            className=""
                            checked={checked}
                            disabled={!checkable}
                            onChange={() => toggleSelect(e.id)}
                            aria-label={`Select ${e.description}`}
                          />
                        )}
                        <KindChip kind={e.kind} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-[var(--text-primary)]" title={e.description}>{e.description}</div>
                          <div className="text-2xs text-[var(--text-tertiary)]">
                            {fmtAge(e.ts)} · {new Date(e.ts).toLocaleTimeString()}
                          </div>
                          {/* S14.5 — storage-clean report card: per-category totals + skip reasons */}
                          {e.kind === "storage_clean" && Array.isArray(e.data.categories) && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(e.data.categories as { label: string; freed: number }[]).map((c) => (
                                <span
                                  key={c.label}
                                  className="rounded bg-[var(--surface-raised)] px-2 py-1 text-2xs text-[var(--text-secondary)]"
                                >
                                  {c.label} · {fmt(c.freed)}
                                </span>
                              ))}
                              {Array.isArray(e.data.skipped) && (e.data.skipped as string[]).length > 0 && (
                                <span
                                  className="rounded bg-[var(--status-warning-bg)] px-2 py-1 text-2xs text-[var(--status-warning)]"
                                  title={(e.data.skipped as string[]).join("\n")}
                                >
                                  {(e.data.skipped as string[]).length} skipped
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        {selectMode && !checkable ? (
                          <span className="text-2xs uppercase tracking-wide text-[var(--text-tertiary)]">
                            {e.undone ? "reverted" : "info only"}
                          </span>
                        ) : e.undone ? (
                          <span className="text-2xs uppercase tracking-wide text-[var(--text-tertiary)]">
                            reverted
                          </span>
                        ) : e.revertible ? (
                          <button
                            className="btn-ghost btn-sm"
                            onClick={() => revert(e.id)}
                            disabled={reverting === e.id}
                          >
                            <IconUndo size={12} /> {reverting === e.id ? "Reverting…" : "Revert"}
                          </button>
                        ) : (
                          <span className="text-2xs uppercase tracking-wide text-[var(--text-tertiary)]">
                            info only
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectMode && (
          <p className="mt-3 text-2xs text-[var(--text-tertiary)]">
            {selectableCount} of {filtered.length} visible change{filtered.length === 1 ? "" : "s"} can be reverted.
            Already-reverted and info-only entries are greyed out.
          </p>
        )}
      </Section>

      <Modal
        open={freshOpen}
        title="Revert your PC to pre-makeover state?"
        confirmLabel="Yes, revert everything"
        danger
        onClose={() => setFreshOpen(false)}
        onConfirm={factoryFresh}
      >
        <p>
          This restores your wallpaper, accent color, theme mode, and startup entries to the state captured in your
          earliest snapshot. It does not delete files.
        </p>
      </Modal>

      <Modal
        open={batchOpen}
        title={`Revert ${selected.size} selected change${selected.size === 1 ? "" : "s"}?`}
        confirmLabel="Revert all"
        danger
        onClose={() => setBatchOpen(false)}
        onConfirm={batchRevert}
      >
        <p>
          This reverts each selected change to its previous state, one at a time. If one fails, the rest still
          complete and the failure is shown. Already-reverted and info-only entries are not selectable.
        </p>
      </Modal>
    </div>
  );
}

function groupByDay(entries: UndoEntry[]): [string, UndoEntry[]][] {
  const groups = new Map<string, UndoEntry[]>();
  for (const e of entries) {
    const day = new Date(e.ts).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return [...groups.entries()];
}
