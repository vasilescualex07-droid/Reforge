import { useEffect, useState } from "react";
import { errorCopy, call, fmt, onEvent } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type {
  ArchiveMove, BigDupeGroup, BiggestFile, CleanNowItem, DriveRadar, DuplicateScan, MoveOp,
  RecycleBinState, SmartFolder, SmartHit, SwapFileInfo, UnusedFile, WindowsOldInfo,
} from "../lib/types";
import { InlineAlert, Modal, Section, toast } from "../components/ui";
import {
  IconRefresh, IconFolder, IconArchive, IconTrash, IconHardDrive, IconScan,
} from "../components/icons";

type Tab = "storage" | "unused" | "sort" | "duplicates";

const HOME = "C:\\Users\\you";

export default function Organize() {
  const [tab, setTab] = useState<Tab>("storage");

  // auto-sort
  const [sortDir, setSortDir] = useState(HOME + "\\Downloads");
  const [sortMode, setSortMode] = useState<"type" | "date">("type");
  const [preview, setPreview] = useState<MoveOp[] | null>(null);
  const [sorting, setSorting] = useState(false);

  // duplicates
  const [dupDir, setDupDir] = useState(HOME + "\\Downloads");
  const [dupScan, setDupScan] = useState<DuplicateScan | null>(null);
  const [dupScanning, setDupScanning] = useState(false);
  const [dupProgress, setDupProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [selectedDups, setSelectedDups] = useState<Set<string>>(new Set());
  const [removeOpen, setRemoveOpen] = useState(false);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);

  // ---- Staging trash ----
  // S2.2 — trash size + smart folders load through useLoad: real error
  // surfaces, one toast per command per session on first failure.
  const { data: trashBytes, error: trashError, refresh: refreshTrash } = useLoad<number>("trash_size");

  const emptyTrash = async () => {
    setEmptying(true);
    try {
      const msg = await call<string>("empty_trash");
      toast(msg);
      refreshTrash();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setEmptying(false);
    }
  };

  // extra tools
  const { data: smartFolders, error: smartError, refresh: refreshSmartFolders } = useLoad<SmartFolder[]>("list_smart_folders");
  const [sfName, setSfName] = useState("");
  const [sfRoot, _setSfRoot] = useState(HOME);
  const [sfExt, setSfExt] = useState("");
  const [sfHits, setSfHits] = useState<SmartHit[] | null>(null);
  const [archiveDir, setArchiveDir] = useState(HOME + "\\Downloads");
  const [archiveMonths, setArchiveMonths] = useState(6);
  const [archivePlan, setArchivePlan] = useState<ArchiveMove[] | null>(null);

  // E1 — live scan progress from the backend (`scan-progress` events emitted
  // by the async scan_duplicates command).
  useEffect(() => onEvent<{ scanned: number; total: number }>("scan-progress", setDupProgress), []);

  // ---- S14.1 Storage radar ----
  const { data: radar, error: radarError, refresh: refreshRadar } = useLoad<DriveRadar[]>("scan_storage_radar");

  // ---- S14.1 Biggest files (with drill-down) ----
  const [bigDir, setBigDir] = useState(HOME);
  const [bigMinMb, setBigMinMb] = useState(50);
  const [bigFiles, setBigFiles] = useState<BiggestFile[]>([]);
  const [bigScanning, setBigScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<number | null>(null);

  useEffect(() => onEvent<{ scanned: number }>("scan-progress", (p) => setScanProgress(p.scanned)), []);

  const scanBig = async (dir = bigDir) => {
    setBigScanning(true);
    setScanProgress(null);
    try {
      const files = await call<BiggestFile[]>("scan_biggest_files", { dir, top_n: 10, min_mb: bigMinMb });
      setBigFiles(files);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBigScanning(false);
      setScanProgress(null);
    }
  };

  // Drill-down: clicking a folder row scans inside it.
  const drillInto = (path: string) => {
    setBigDir(path);
    scanBig(path);
  };

  // ---- S14.2 One-click safe clean ----
  const [cleanPreview, setCleanPreview] = useState<CleanNowItem[] | null>(null);
  const [cleanSelected, setCleanSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);

  const loadCleanPreview = async () => {
    try {
      const items = await call<CleanNowItem[]>("preview_clean_now");
      setCleanPreview(items);
      setCleanSelected(new Set(items.map((i) => i.id)));
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const doClean = async () => {
    setCleaning(true);
    try {
      const r = await call<{ freed_bytes: number; deleted_count: number; skipped_admin: string[] }>(
        "clean_now",
        { ids: [...cleanSelected] }
      );
      const note = r.skipped_admin.length ? ` (${r.skipped_admin.length} skipped — need admin)` : "";
      toast(
        r.deleted_count > 0
          ? `Freed ${fmt(r.freed_bytes)} across ${r.deleted_count} item(s)${note}`
          : `Would free ${fmt(r.freed_bytes)} — dry run, nothing deleted${note}`
      );
      setCleanPreview(null);
      refreshRadar();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setCleaning(false);
      setCleanOpen(false);
    }
  };

  // ---- S14.3 Unused files ----
  const [unusedDir, setUnusedDir] = useState(HOME + "\\Downloads");
  const [unusedDays, setUnusedDays] = useState(180);
  const [unusedMinMb, setUnusedMinMb] = useState(10);
  const [unused, setUnused] = useState<UnusedFile[]>([]);
  const [unusedScanning, setUnusedScanning] = useState(false);
  const [unusedSelected, setUnusedSelected] = useState<Set<string>>(new Set());
  const [unusedOpen, setUnusedOpen] = useState(false);

  const scanUnused = async () => {
    setUnusedScanning(true);
    setScanProgress(null);
    try {
      const files = await call<UnusedFile[]>("scan_unused", {
        dir: unusedDir,
        older_than_days: unusedDays,
        min_mb: unusedMinMb,
      });
      setUnused(files);
      setUnusedSelected(new Set());
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setUnusedScanning(false);
      setScanProgress(null);
    }
  };

  const doDeleteUnused = async () => {
    try {
      const freed = await call<number>("delete_unused", { paths: [...unusedSelected] });
      toast(`Moved ${unusedSelected.size} file(s) to the staging trash — freed ${fmt(freed)}`);
      setUnused((u) => u.filter((f) => !unusedSelected.has(f.path)));
      setUnusedSelected(new Set());
      refreshTrash();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setUnusedOpen(false);
    }
  };

  // ---- S14.6 Bonus saves ----
  const { data: recycle, error: recycleError, refresh: refreshRecycle } = useLoad<RecycleBinState>("recycle_bin_state");
  const [windowsOld, setWindowsOld] = useState<WindowsOldInfo | null>(null);
  const [swapFiles, setSwapFiles] = useState<SwapFileInfo[] | null>(null);
  const [dupes, setDupes] = useState<BigDupeGroup[] | null>(null);
  const [dupesLoading, setDupesLoading] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [emptyingRecycle, setEmptyingRecycle] = useState(false);

  const loadBonus = async () => {
    try {
      const [w, sw] = await Promise.all([
        call<WindowsOldInfo>("windows_old_info"),
        call<SwapFileInfo[]>("swap_file_sizes"),
      ]);
      setWindowsOld(w);
      setSwapFiles(sw);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };
  useEffect(() => {
    loadBonus();
  }, []);

  const scanBigDupes = async () => {
    setDupesLoading(true);
    try {
      const g = await call<BigDupeGroup[]>("big_dupe_groups", { min_mb: 500 });
      setDupes(g);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setDupesLoading(false);
    }
  };

  const emptyRecycle = async () => {
    setEmptyingRecycle(true);
    try {
      const msg = await call<string>("empty_recycle_bin");
      toast(msg);
      refreshRecycle();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setEmptyingRecycle(false);
      setRecycleOpen(false);
    }
  };

  // ---- Sort ----
  const previewSort = async () => {
    try {
      const p = await call<MoveOp[]>("preview_sort", { dir: sortDir, mode: sortMode });
      setPreview(p);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const applySort = async () => {
    setSorting(true);
    try {
      const msg = await call<string>("apply_sort", { dir: sortDir, mode: sortMode });
      toast(msg);
      setPreview(null);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setSorting(false);
    }
  };

  // ---- Duplicates ----
  const scanDups = async () => {
    setDupScanning(true);
    setDupProgress(null);
    try {
      const s = await call<DuplicateScan>("scan_duplicates", { dir: dupDir });
      setDupScan(s);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setDupScanning(false);
      setDupProgress(null);
    }
  };

  const removeDups = async () => {
    if (!dupScan) return;
    const paths = dupScan.groups
      .filter((g) => selectedDups.has(g.id))
      .flatMap((g) => g.files.slice(1).map((f) => f.path));
    if (paths.length === 0) return;
    try {
      const msg = await call<string>("remove_duplicates", { paths });
      toast(msg);
      setDupScan(null);
      setSelectedDups(new Set());
      refreshTrash();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  // ---- Smart Folders ----
  const createSmartFolder = async () => {
    if (!sfName.trim()) return;
    try {
      const sf = await call<SmartFolder>("create_smart_folder", {
        name: sfName,
        root: sfRoot,
        extensions: sfExt.split(",").map((s) => s.trim()).filter(Boolean),
      });
      refreshSmartFolders();
      setSfName("");
      toast(`Smart folder "${sf.name}" created`);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const runSmartFolder = async (sf: SmartFolder) => {
    try {
      const hits = await call<SmartHit[]>("run_smart_folder", { id: sf.id });
      setSfHits(hits);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  // ---- Archive ----
  const planArchive = async () => {
    try {
      const p = await call<ArchiveMove[]>("plan_archive", { dir: archiveDir, months: archiveMonths });
      setArchivePlan(p);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const doArchive = async () => {
    try {
      const msg = await call<string>("apply_archive", { dir: archiveDir, months: archiveMonths });
      toast(msg);
      setArchivePlan(null);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };



  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Organize</h1>
        <p className="page-subtitle">
          Storage analysis, auto-sort, duplicates, smart folders, archives
        </p>
      </header>

      <div className="segment">
        {(["storage", "unused", "sort", "duplicates"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`segment-btn ${tab === t ? "active" : ""}`}>
            {t === "storage" ? "Storage" : t === "unused" ? "Unused" : t === "sort" ? "Auto-sort" : "Duplicates"}
          </button>
        ))}
      </div>

      {tab === "storage" && (
        <>
          <Section
            title="Storage radar"
            subtitle="See exactly what's clogging — per-drive usage and the top folders"
            actions={
              <button className="btn-primary" onClick={refreshRadar}>
                <IconRefresh size={14} /> Refresh
              </button>
            }
          >
            {radarError && <InlineAlert kind="warning">{errorCopy(radarError)}</InlineAlert>}
            {radar && radar.length > 0 ? (
              <div className="space-y-4">
                {radar.map((d) => {
                  const pct = d.total > 0 ? Math.round((d.used / d.total) * 100) : 0;
                  return (
                    <div key={d.mount} className="rounded-xl bg-[var(--surface-overlay)] p-4">
                      <div className="flex items-center gap-2">
                        <IconHardDrive size={16} className="text-[var(--text-tertiary)]" />
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{d.label}</span>
                        <span className="text-2xs text-[var(--text-tertiary)]">{fmt(d.used)} used · {fmt(d.free)} free · {pct}%</span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      {d.top_level.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[...d.top_level].sort((a, b) => b.size - a.size).map((f) => (
                            <button
                              key={f.path}
                              className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-raised)] px-2 py-1 text-2xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                              onClick={() => drillInto(f.path)}
                              title={f.path}
                            >
                              <IconFolder size={12} /> {f.name} · {fmt(f.size)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">No drives detected.</div>
            )}
          </Section>

          <Section
            title="Biggest files"
            subtitle="The top space hogs in a folder — click a result to drill deeper"
            actions={
              <button className="btn-primary" onClick={() => scanBig()} disabled={bigScanning}>
                <IconScan size={14} /> {bigScanning ? "Scanning…" : "Scan"}
              </button>
            }
          >
            <div className="mb-4 flex gap-2">
              <input className="input flex-1" value={bigDir} onChange={(e) => setBigDir(e.target.value)} />
              <label className="flex items-center gap-1 text-2xs text-[var(--text-tertiary)]">
                min
                <input
                  className="input w-20"
                  type="number"
                  min={1}
                  value={bigMinMb}
                  onChange={(e) => setBigMinMb(Math.max(1, Number(e.target.value) || 1))}
                />
                MB
              </label>
            </div>
            {scanProgress !== null && bigScanning && (
              <div className="mb-2 text-2xs text-[var(--text-tertiary)]">Scanned {scanProgress} files…</div>
            )}
            {bigFiles.length > 0 ? (
              <div className="space-y-2">
                {bigFiles.map((f) => (
                  <div key={f.path} className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                    <IconFolder size={16} className="text-[var(--text-tertiary)]" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[var(--text-primary)]" title={f.path}>{f.path}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">{f.category}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[var(--text-secondary)]">{fmt(f.size)}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">
                        {new Date(f.modified * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Scan a folder to find its biggest files.</div>
            )}
          </Section>

          <Section
            title="One-click safe clean"
            subtitle="Regenerable junk is deleted; old installers move to the staging trash (undoable)"
            actions={
              !cleanPreview ? (
                <button className="btn-primary" onClick={loadCleanPreview}>
                  <IconTrash size={14} /> Preview what can go
                </button>
              ) : (
                <button className="btn-primary" onClick={() => setCleanOpen(true)} disabled={cleaning || cleanSelected.size === 0}>
                  <IconTrash size={14} /> Clean {cleanSelected.size} item(s)
                </button>
              )
            }
          >
            {cleanPreview === null ? (
              <div className="empty-state">Preview first — nothing is deleted without your confirm.</div>
            ) : cleanPreview.length === 0 ? (
              <div className="empty-state">Nothing eligible right now — nice and tidy.</div>
            ) : (
              <div className="space-y-2">
                {cleanPreview.map((it) => (
                  <label key={it.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={cleanSelected.has(it.id)}
                      onChange={(e) => {
                        const next = new Set(cleanSelected);
                        if (e.target.checked) next.add(it.id);
                        else next.delete(it.id);
                        setCleanSelected(next);
                      }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[var(--text-primary)]">{it.label}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]" title={it.path}>
                        {it.action === "trash" ? "Moves to staging trash · undoable" : "Regenerable · permanent"}
                        {it.admin_required ? " · needs admin" : ""}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-[var(--text-secondary)]">{fmt(it.size)}</div>
                  </label>
                ))}
              </div>
            )}
          </Section>

          <Section title="More ways to save" subtitle="Recycle Bin, previous Windows install, system files, duplicate groups">
            {recycleError && <InlineAlert kind="warning">{errorCopy(recycleError)}</InlineAlert>}
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                <IconTrash size={16} className="text-[var(--text-tertiary)]" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">Recycle Bin</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">
                    {recycle ? (recycle.empty ? "Already empty" : `${fmt(recycle.size)} — emptied with confirm, no undo`)
                      : "Checking…"}
                  </div>
                </div>
                <button
                  className="btn-secondary"
                  disabled={!recycle || recycle.empty || emptyingRecycle}
                  onClick={() => setRecycleOpen(true)}
                >
                  Empty
                </button>
              </div>

              {windowsOld && windowsOld.exists && (
                <div className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                  <IconFolder size={16} className="text-[var(--text-tertiary)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">Windows.old — {fmt(windowsOld.size)}</div>
                    <div className="text-2xs text-[var(--text-tertiary)]">{windowsOld.note}</div>
                  </div>
                </div>
              )}

              {swapFiles && swapFiles.length > 0 && swapFiles.map((s) => (
                <div key={s.name} className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                  <IconHardDrive size={16} className="text-[var(--text-tertiary)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">{s.name} — {fmt(s.size)}</div>
                    <div className="text-2xs text-[var(--text-tertiary)]">{s.note}</div>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                <IconArchive size={16} className="text-[var(--text-tertiary)]" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">Big duplicate groups</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">
                    {dupes ? `${dupes.length} group(s) wasting ≥ 500 MB` : "Duplicate sets worth deleting"}
                  </div>
                </div>
                <button className="btn-secondary" onClick={scanBigDupes} disabled={dupesLoading}>
                  {dupesLoading ? "Scanning…" : "Scan"}
                </button>
              </div>
              {dupes && dupes.length > 0 && (
                <div className="space-y-1">
                  {dupes.map((g) => (
                    <div key={g.id} className="rounded-xl bg-[var(--surface-overlay)] px-4 py-2 text-2xs text-[var(--text-secondary)]" title={g.sample_paths.join("\n")}>
                      {g.file_count} files · {fmt(g.wasted_bytes)} wasted — e.g. {g.sample_paths[0] ?? ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </>
      )}

      {tab === "unused" && (
        <Section
          title="Time to let go"
          subtitle="Files untouched for a long time — last-changed is the honest proxy on Windows"
          actions={
            <button className="btn-primary" onClick={scanUnused} disabled={unusedScanning}>
              <IconScan size={14} /> {unusedScanning ? "Scanning…" : "Scan"}
            </button>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input className="input flex-1" value={unusedDir} onChange={(e) => setUnusedDir(e.target.value)} />
            <label className="flex items-center gap-1 text-2xs text-[var(--text-tertiary)]">
              older than
              <input
                className="input w-20"
                type="number"
                min={1}
                value={unusedDays}
                onChange={(e) => setUnusedDays(Math.max(1, Number(e.target.value) || 1))}
              />
              days
            </label>
            <label className="flex items-center gap-1 text-2xs text-[var(--text-tertiary)]">
              min
              <input
                className="input w-20"
                type="number"
                min={1}
                value={unusedMinMb}
                onChange={(e) => setUnusedMinMb(Math.max(1, Number(e.target.value) || 1))}
              />
              MB
            </label>
          </div>
          {scanProgress !== null && unusedScanning && (
            <div className="mb-2 text-2xs text-[var(--text-tertiary)]">Scanned {scanProgress} files…</div>
          )}
          {unused.length > 0 ? (
            <>
              <div className="space-y-2">
                {unused.map((f) => (
                  <label key={f.path} className="flex items-center gap-3 rounded-xl bg-[var(--surface-overlay)] px-4 py-3">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={unusedSelected.has(f.path)}
                      onChange={(e) => {
                        const next = new Set(unusedSelected);
                        if (e.target.checked) next.add(f.path);
                        else next.delete(f.path);
                        setUnusedSelected(next);
                      }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[var(--text-primary)]" title={f.path}>{f.path}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">{f.category}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[var(--text-secondary)]">{fmt(f.size)}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">last changed {f.days_old}d ago</div>
                    </div>
                  </label>
                ))}
              </div>
              <button
                className="btn-primary mt-4"
                disabled={unusedSelected.size === 0}
                onClick={() => setUnusedOpen(true)}
              >
                <IconTrash size={14} /> Move {unusedSelected.size} to staging trash
              </button>
            </>
          ) : (
            <div className="empty-state">
              {unusedScanning ? "Scanning…" : "Scan a folder to find files worth letting go."}
            </div>
          )}
        </Section>
      )}

      {tab === "sort" && (
        <Section title="Auto-sort" subtitle="Preview and organize files by type or date">
          <div className="mb-4 flex gap-2">
            <input className="input" value={sortDir} onChange={(e) => setSortDir(e.target.value)} />
            <div className="segment">
              {(["type", "date"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSortMode(m)}
                  className={`segment-btn ${sortMode === m ? "active" : ""}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button className="btn-ghost" onClick={previewSort}>Preview</button>
            {preview && (
              <button className="btn-primary" onClick={applySort} disabled={sorting}>
                {sorting ? "Sorting…" : `Sort ${preview.length} files`}
              </button>
            )}
          </div>
          {preview && (
            <div className="space-y-1.5">
              {preview.map((m, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs">
                  <span className="text-[var(--text-tertiary)]">→</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={m.from}>{m.from}</span>
                  <span className="text-[var(--text-secondary)]">→</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]" title={m.to}>{m.to}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "duplicates" && (
        <Section
          title="Duplicate finder"
          subtitle="Find and safely remove duplicate files"
          actions={
            <button className="btn-primary" onClick={scanDups} disabled={dupScanning}>
              <IconRefresh size={14} /> {dupScanning ? "Scanning…" : "Scan"}
            </button>
          }
        >
          <div className="mb-4 flex gap-2">
            <input className="input" value={dupDir} onChange={(e) => setDupDir(e.target.value)} />
          </div>
          {trashError && <InlineAlert>{trashError}</InlineAlert>}
          {trashBytes !== null && trashBytes > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <IconTrash size={14} className="text-[var(--text-tertiary)]" />
                Staging trash: <strong className="text-[var(--text-primary)]">{fmt(trashBytes)}</strong>{" "}
                <span className="text-2xs text-[var(--text-tertiary)]">staged duplicates — reversible until emptied</span>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setEmptyOpen(true)} disabled={emptying}>
                Empty trash
              </button>
            </div>
          )}
          {dupScanning && dupProgress && dupProgress.total > 0 && (
            <div className="mb-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3">
              <div className="mb-1.5 flex justify-between text-2xs text-[var(--text-tertiary)]">
                <span>Scanning… {dupProgress.scanned.toLocaleString()} / {dupProgress.total.toLocaleString()} files</span>
                <span>{Math.min(100, Math.round((dupProgress.scanned / dupProgress.total) * 100))}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                <div
                  className="h-full rounded-full bg-[var(--accent-hex)] transition-[width] duration-100"
                  style={{ width: `${Math.min(100, (dupProgress.scanned / dupProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {dupScan && dupScan.groups.length > 0 ? (
            <>
              <div className="mb-3 flex items-center justify-between rounded-xl bg-[var(--surface-overlay)] px-4 py-3 text-sm">
                <span className="text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">{fmt(dupScan.total_wasted)}</strong> wasted across{" "}
                  {dupScan.groups.length} groups
                </span>
                <button className="btn-primary text-xs" onClick={() => setRemoveOpen(true)} disabled={selectedDups.size === 0}>
                  Remove selected
                </button>
              </div>
              <div className="space-y-2">
                {dupScan.groups.map((g) => (
                  <div
                    key={g.id}
                    className={`rounded-xl border px-4 py-3 transition-colors ${
                      selectedDups.has(g.id)
                        ? "border-[var(--border-accent)] bg-[var(--surface-selected)]"
                        : "border-[var(--border-default)] bg-[var(--surface-overlay)]"
                    }`}
                  >
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedDups.has(g.id)}
                        onChange={() => {
                          setSelectedDups((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.id)) next.delete(g.id);
                            else next.add(g.id);
                            return next;
                          });
                        }}
                        className=""
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{g.name}</div>
                        <div className="text-2xs text-[var(--text-tertiary)]">
                          {g.files.length} copies · {fmt(g.size)} each
                        </div>
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">Scan a directory to find duplicate files.</div>
          )}
        </Section>
      )}

      {/* Extra tools row */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Smart folders" subtitle="Auto-updating file collections">
          {smartError && <InlineAlert>{smartError}</InlineAlert>}
          <div className="mb-3 flex gap-2">
            <input className="input" placeholder="Name" value={sfName} onChange={(e) => setSfName(e.target.value)} />
            <input className="input" placeholder="Extensions (csv)" value={sfExt} onChange={(e) => setSfExt(e.target.value)} />
            <button className="btn-primary shrink-0 text-xs" onClick={createSmartFolder}>
              Create
            </button>
          </div>
          <div className="space-y-1.5">
            {(smartFolders ?? []).map((sf) => (
              <div
                key={sf.id}
                className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2"
              >
                <IconFolder size={14} className="text-[var(--text-tertiary)]" />
                <span className="flex-1 text-xs text-[var(--text-secondary)]">{sf.name}</span>
                <button
                  className="text-2xs text-[var(--text-secondary)] hover:underline"
                  onClick={() => runSmartFolder(sf)}
                >
                  Run
                </button>
              </div>
            ))}
          </div>
          {sfHits && (
            <div className="mt-3 space-y-1">
              {sfHits.map((h) => (
                <div key={h.path} className="truncate text-2xs text-[var(--text-tertiary)]" title={h.path}>{h.path}</div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Archive old files" subtitle="Zip files older than N months into a dated archive">
          <div className="mb-3 flex gap-2">
            <input className="input" value={archiveDir} onChange={(e) => setArchiveDir(e.target.value)} />
            <select
              value={archiveMonths}
              onChange={(e) => setArchiveMonths(+e.target.value)}
            >
              {[3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>{m} months</option>
              ))}
            </select>
            <button className="btn-ghost text-xs" onClick={planArchive}>Preview</button>
            {archivePlan && (
              <button className="btn-primary text-xs" onClick={doArchive}>
                <IconArchive size={12} /> Archive {archivePlan.length}
              </button>
            )}
          </div>
        </Section>
      </div>

      <Modal open={removeOpen} title="Remove duplicates?" onClose={() => setRemoveOpen(false)} onConfirm={removeDups} confirmLabel="Remove" danger>
        <p>
          This will move {selectedDups.size} groups of duplicate files to a staging trash. You can undo from History or
          empty the trash from here.
        </p>
      </Modal>

      <Modal open={emptyOpen} title="Empty staging trash?" onClose={() => setEmptyOpen(false)} onConfirm={emptyTrash} confirmLabel="Empty trash" danger>
        <p>
          {trashBytes && trashBytes > 0
            ? `This permanently deletes ${fmt(trashBytes)} of staged duplicate files. This cannot be undone.`
            : "This permanently deletes all staged duplicate files. This cannot be undone."}
        </p>
      </Modal>

      <Modal open={cleanOpen} title="Run safe clean?" onClose={() => setCleanOpen(false)} onConfirm={doClean} confirmLabel="Clean" danger>
        <p>
          {cleanSelected.size} item(s) — regenerable junk is deleted permanently after this confirm;
          old installers move to the staging trash (undoable from History).
        </p>
      </Modal>

      <Modal open={unusedOpen} title="Move unused files to trash?" onClose={() => setUnusedOpen(false)} onConfirm={doDeleteUnused} confirmLabel="Move to trash" danger>
        <p>
          {unusedSelected.size} file(s) will move to the staging trash — you can undo from History or restore them there.
        </p>
      </Modal>

      <Modal open={recycleOpen} title="Empty the Recycle Bin?" onClose={() => setRecycleOpen(false)} onConfirm={emptyRecycle} confirmLabel="Empty" danger>
        <p>This permanently deletes everything in the Recycle Bin. There is no undo for this.</p>
      </Modal>
    </div>
  );
}
