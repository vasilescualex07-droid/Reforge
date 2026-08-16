// Makeover Session (ROADMAP C5). One guided tab that does the whole makeover:
// 1) snapshot, 2) whole-PC scan, 3) review & clean, 4) style quiz → apply,
// 5) done + revert-everything. Every command is real; nothing is decorative.

import { useEffect, useRef, useState } from "react";
import { errorCopy, call, fmt } from "../lib/api";
import { recordStyleApplied } from "../lib/styleAnalytics";
import type { CleanResult, DuplicateScan, DuplicateGroup, HealthScore, JunkScan, SceneConfig, StartupEntry } from "../lib/types";
import { ScenePreview, Section, StatusDot, toast } from "../components/ui";
import type { QuizAnswers, StyleDef } from "../styles/types";
import {
  ALL_STYLES,
  QUIZ,
  EMPTY_ANSWERS,
  mergeAnswers,
  rankStyles,
  buildMyStyle,
  getWallpaper,
  sceneConfigForStyle,
} from "../styles";
import {
  loadSession,
  saveSession,
  clearSession,
  sessionAgeMinutes,
  type SessionState,
} from "../lib/sessionStore";

interface UserFolder { label: string; path: string; exists: boolean }
interface BloatwareItem { name: string; publisher: string; size_mb: number }

const STEPS = [
  { id: "snapshot", label: "Protect" },
  { id: "scan", label: "Scan" },
  { id: "clean", label: "Clean" },
  { id: "style", label: "Style" },
  { id: "done", label: "Done" },
] as const;

type Step = (typeof STEPS)[number]["id"];
const STEP_INDEX = STEPS.map((s) => s.id);

export default function MakeoverSession() {
  const [step, setStep] = useState<Step>("snapshot");
  const [maxStep, setMaxStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // 1. snapshot
  const [snapshotId, setSnapshotId] = useState<string | null>(null);

  // 2. scan
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [junk, setJunk] = useState<JunkScan | null>(null);
  const [dups, setDups] = useState<DuplicateGroup[]>([]);
  const [dupWasted, setDupWasted] = useState(0);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [bloatware, setBloatware] = useState<BloatwareItem[]>([]);

  // 3. clean
  const [junkSel, setJunkSel] = useState<Set<string>>(new Set());
  const [dupPaths, setDupPaths] = useState<string[]>([]);
  // staged duplicate count survives a resume (paths are re-derived on a fresh scan)
  const [dupStagedCount, setDupStagedCount] = useState(0);
  const [cleaning, setCleaning] = useState(false);
  const [cleanReport, setCleanReport] = useState<string[]>([]);
  const [freedBytes, setFreedBytes] = useState(0);

  // 2b. scan-in-progress
  const [scanning, setScanning] = useState(false);

  // 4. style
  const [quizStep, setQuizStep] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>(EMPTY_ANSWERS);
  const [quizDone, setQuizDone] = useState(false);
  const [applyingStyle, setApplyingStyle] = useState<string | null>(null);
  const [appliedName, setAppliedName] = useState<string | null>(null);

  // 3b. explicit skips with reasons (A3.3)
  const [skips, setSkips] = useState<Record<string, string>>({});
  const [skipEditing, setSkipEditing] = useState<string | null>(null);
  const [skipDraft, setSkipDraft] = useState("");

  // A3.1 — resume a saved session on mount
  const [resume, setResume] = useState<SessionState | null>(null);
  // the mirror effect below would otherwise overwrite the stored session with
  // the initial (empty) state on mount, before the resume state lands — skip
  // its very first write when a resume is pending
  const skipFirstMirror = useRef(false);

  // C3 — animated quiz previews on hover (nothing animates until hovered)
  const [hoverQuiz, setHoverQuiz] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (s && s.step !== "done" && STEPS.some((x) => x.id === s.step)) {
      skipFirstMirror.current = true;
      setResume(s);
      setStep(s.step as Step);
      setMaxStep(s.maxStep);
      if (s.snapshotId) setSnapshotId(s.snapshotId);
      if (s.appliedName) setAppliedName(s.appliedName);
      setFreedBytes(s.freedBytes);
      setDupStagedCount(s.dupPathsCount);
    }
  }, []);

  // A3.1 — mirror every meaningful change into the store
  useEffect(() => {
    if (skipFirstMirror.current) {
      skipFirstMirror.current = false;
      return;
    }
    if (!step) return;
    saveSession({
      step,
      maxStep,
      snapshotId,
      appliedName,
      freedBytes,
      dupPathsCount: dupStagedCount,
      savedAt: Date.now(),
    });
    if (step === "done") clearSession();
  }, [step, maxStep, snapshotId, appliedName, freedBytes, dupStagedCount]);

  const takeSnapshot = async () => {
    setBusy(true);
    try {
      const snap = await call<{ id: string; ts: number }>("snapshot_now", {});
      setSnapshotId(snap.id);
      // A3.4 — verify the snapshot file actually landed on disk
      try {
        const snaps = await call<{ id: string; ts: number }[]>("list_snapshots", {});
        if (snaps.some((s) => s.id === snap.id)) {
          toast("Snapshot written to disk and verified — nothing is one-way now");
        } else {
          toast("Snapshot taken, but the file check came back empty — verify in History", "info");
        }
      } catch {
        toast("Snapshot taken — could not verify the file on disk", "info");
      }
      advance(1);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    setDups([]);
    setDupWasted(0);
    setCleanReport([]);
    try {
      const [h, j, s] = await Promise.all([
        call<HealthScore>("get_health_score", {}).catch(() => null),
        call<JunkScan>("scan_junk", {}).catch(() => null),
        call<StartupEntry[]>("list_startup", {}).catch(() => [] as StartupEntry[]),
      ]);
      setHealth(h);
      setJunk(j);
      setStartup(s);
      // whole-PC duplicate sweep across every well-known user folder (C5)
      const folders = await call<UserFolder[]>("get_user_folders", {}).catch(() => [] as UserFolder[]);
      const merged = new Map<string, DuplicateGroup>();
      let wasted = 0;
      for (const f of folders.filter((x) => x.exists && x.label !== "Home")) {
        const scan = await call<DuplicateScan>("scan_duplicates", { dir: f.path, min_size_mb: 10 }).catch(() => null);
        if (!scan) continue;
        for (const g of scan.groups) {
          const key = `${g.name}|${g.size}`;
          if (!merged.has(key)) {
            merged.set(key, g);
            wasted += g.size;
          }
        }
      }
      setDups([...merged.values()]);
      setDupWasted(wasted);
      const bloat = await call<BloatwareItem[]>("list_bloatware", {}).catch(() => [] as BloatwareItem[]);
      setBloatware(bloat);
      // default selections: all junk, duplicate copies (keep the newest)
      setJunkSel(new Set((j?.items ?? []).filter((x) => !x.admin_required).map((x) => x.id)));
      setDupPaths(merged.size ? [...merged.values()].flatMap((g) => removeCopies(g)) : []);
      advance(2);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (step === "scan") runScan();
    // runScan is intentionally excluded: re-running the scan on every render
    // (and again whenever `scanning` flips back to false) would loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const toggleJunk = (id: string) => {
    setJunkSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDup = (path: string) => {
    setDupPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const runClean = async () => {
    setCleaning(true);
    const report: string[] = [];
    try {
      if (junkSel.size > 0 && junk) {
        const res = await call<CleanResult>("clean_junk", { ids: [...junkSel] });
        setFreedBytes((v) => v + res.freed_bytes);
        report.push(`Junk: freed ${fmt(res.freed_bytes)}${res.skipped_admin.length ? ` · ${res.skipped_admin.length} need admin` : ""}`);
      }
      if (dupPaths.length > 0) {
        const msg = await call<string>("remove_duplicates", { paths: dupPaths });
        setDupStagedCount(dupPaths.length);
        report.push(`Duplicates: ${msg.toLowerCase().includes("reversible") ? "moved to staging trash (reversible)" : msg}`);
      }
      if (report.length === 0) report.push("Nothing selected to clean.");
      setCleanReport(report);
      toast(report.join(" · "));
      advance(3);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setCleaning(false);
    }
  };

  const resetQuiz = () => {
    setQuizStep(0);
    setAnswers(EMPTY_ANSWERS);
    setQuizDone(false);
  };

  const pickQuiz = (optIdx: number) => {
    const next = mergeAnswers(answers, QUIZ[quizStep], optIdx);
    setAnswers(next);
    if (quizStep + 1 < QUIZ.length) setQuizStep(quizStep + 1);
    else setQuizDone(true);
  };

  const quizResults = quizDone ? rankStyles(ALL_STYLES, answers).slice(0, 3) : [];
  const myStyle = quizDone ? buildMyStyle(answers) : null;

  const applyStyle = async (s: StyleDef) => {
    setApplyingStyle(s.id);
    try {
      const w = s.wallpaper;
      let scene: SceneConfig | null = null;
      if (w.type === "scene") {
        const all = await call<SceneConfig[]>("list_wallpaper_scenes", {}).catch(() => null);
        scene = all?.find((x) => x.id === w.sceneId) ?? null;
      }
      const wallpaper = w.type !== "scene" ? getWallpaper(w.id)?.file : undefined;
      const res = await call<{ ok: boolean; name: string; notes?: string[] }>("apply_style", {
        style: {
          id: s.id,
          name: s.name,
          mode: s.mode,
          accent_hex: s.accent_hex,
          transparency: s.transparency,
          wallpaper,
          wallpaper_type: w.type,
          scene: scene ? { ...scene, ...(s.sceneTweak ?? {}) } : undefined,
          font: s.font,
          sound_scheme: s.sound_scheme?.guid,
          rgb: s.rgb,
        },
      });
      setAppliedName(s.name);
      // S6.7 — record the apply in the local history (never leaves this PC).
      recordStyleApplied(s);
      if (res.notes?.length) toast(res.notes.join(" · "), "info");
      toast(`Applied “${s.name}” — revert anytime from History`);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setApplyingStyle(null);
    }
  };

  const revertEverything = async () => {
    setBusy(true);
    try {
      await call<string>("factory_fresh", {});
      toast("Restored your pre-makeover state — check History");
      setAppliedName(null);
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBusy(false);
    }
  };

  // ---- A3.3 skip-with-reason ----
  const startSkip = (id: string) => {
    setSkipEditing(id);
    setSkipDraft(skips[id] ?? "");
  };
  const commitSkip = (id: string) => {
    if (skipDraft.trim()) {
      setSkips((prev) => ({ ...prev, [id]: skipDraft.trim() }));
      // a skipped item is deselected, never cleaned
      setJunkSel((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      setSkips((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    setSkipEditing(null);
    setSkipDraft("");
  };

  // ---- A3.2 session report (markdown) ----
  const exportReport = () => {
    const lines: string[] = [];
    lines.push(`# Makeover session report`);
    lines.push(`Generated ${new Date().toLocaleString()}`);
    lines.push(``);
    lines.push(`## What happened`);
    lines.push(`- Protection: ${snapshotId ? "restore point taken" : "not taken"}`);
    lines.push(`- Storage freed: ${freedBytes > 0 ? fmt(freedBytes) : "nothing"}`);
    lines.push(`- Duplicates: ${dupStagedCount} file(s) staged to trash`);
    lines.push(`- Look applied: ${appliedName ?? "none"}`);
    lines.push(``);
    const skipList = Object.entries(skips);
    if (skipList.length > 0) {
      lines.push(`## Skipped (with reasons)`);
      for (const [id, reason] of skipList) {
        const label = junk?.items.find((j) => j.id === id)?.label ?? id;
        lines.push(`- ${label}: ${reason}`);
      }
      lines.push(``);
    }
    if (cleanReport.length > 0) {
      lines.push(`## Cleanup log`);
      for (const r of cleanReport) lines.push(`- ${r}`);
      lines.push(``);
    }
    lines.push(`Every change is reversible from History.`);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `makeover-report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Session report exported as markdown");
  };

  /** Unlock a step and jump to it (forward). */
  const advance = (idx: number) => {
    setMaxStep((m) => Math.max(m, idx));
    setStep(STEPS[idx].id as Step);
  };

  /** Navigate to any unlocked step (backward always allowed). */
  const go = (next: Step) => {
    if (STEP_INDEX.indexOf(next) <= maxStep) setStep(next);
  };

  const junkTotal = junk?.total_bytes ?? 0;
  const dupCount = dups.reduce((a, g) => a + g.files.length, 0);

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Makeover Session</h1>
        <p className="page-subtitle">One guided pass: protect, scan, clean, style, done. Every step is reversible from History.</p>
      </header>

      {resume && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-accent)] bg-[var(--surface-selected)] px-4 py-3">
          <div className="flex items-center gap-3">
            <StatusDot status="success" pulse />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">Resumed a saved makeover</div>
              <div className="text-2xs text-[var(--text-tertiary)]">
                You were on step {STEP_INDEX.indexOf(resume.step as Step) + 1} · {STEPS.find((s) => s.id === resume.step)?.label.toLowerCase()} ·{" "}
                {sessionAgeMinutes(resume) !== null ? `saved ${sessionAgeMinutes(resume)}m ago` : "saved earlier"}
              </div>
            </div>
          </div>
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              setResume(null);
              clearSession();
              setStep("snapshot");
              setMaxStep(0);
              setSnapshotId(null);
              setAppliedName(null);
              setFreedBytes(0);
              setDupPaths([]);
              setDupStagedCount(0);
            }}
          >
            Start over
          </button>
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2">
        {STEPS.map((s, i) => {
          const active = step === s.id;
          const done = STEP_INDEX.indexOf(step) > i || (i === 4 && appliedName);
          return (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${active ? "bg-[var(--surface-selected)] text-[var(--accent-hex)]" : done ? "text-[var(--status-success)] hover:bg-[var(--surface-hover)]" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]"}`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${active ? "bg-[var(--accent-hex)] text-white" : done ? "bg-[var(--status-success)] text-white" : "bg-[var(--gray-4)] text-[var(--text-secondary)]"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* ---- 1. Protect ---- */}
      {step === "snapshot" && (
        <Section title="Step 1 · Protect" subtitle="Nothing you do here should be one-way">
          <div className="flex items-start gap-4">
            <div className="flex-1 space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                Reforge captures your current look — accent, mode, transparency, wallpaper, and startup entries — into a restore point.
                If you hate the makeover later, one click in History brings it all back.
              </p>
              {snapshotId ? (
                <div className="rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success)]">
                  <StatusDot status="success" /> Restore point created. Your desktop is protected.
                </div>
              ) : (
                <button className="btn-primary" onClick={takeSnapshot} disabled={busy}>
                  {busy ? "Capturing…" : "Take a snapshot"}
                </button>
              )}
            </div>
            <div className="hidden w-56 shrink-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-3 text-2xs text-[var(--text-tertiary)] lg:block">
              <div className="mb-1.5 font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Captured</div>
              <ul className="space-y-1">
                <li>· Accent color</li>
                <li>· Light / dark mode</li>
                <li>· Taskbar transparency</li>
                <li>· Wallpaper + live engines</li>
                <li>· Startup entries</li>
              </ul>
            </div>
          </div>
        </Section>
      )}

      {/* ---- 2. Scan ---- */}
      {step === "scan" && (
        <Section title="Step 2 · Whole-PC scan" subtitle="Health, junk, duplicates, startup, bloatware — one sweep">
          {scanning ? (
            <div className="space-y-3">
              <div className="skeleton h-24 w-full" />
              <div className="skeleton h-24 w-full" />
              <p className="text-2xs text-[var(--text-tertiary)]">Scanning your folders — Desktop, Documents, Downloads, Pictures, OneDrive…</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card p-4">
                <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Health score</div>
                <div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{health?.score ?? "—"}</div>
                <div className="text-2xs text-[var(--text-tertiary)]">{health ? `${health.startup_count} startup · disk ${health.disk_free_pct}% free` : "unavailable"}</div>
              </div>
              <div className="card p-4">
                <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Junk found</div>
                <div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{fmt(junkTotal)}</div>
                <div className="text-2xs text-[var(--text-tertiary)]">{junk?.items.length ?? 0} areas</div>
              </div>
              <div className="card p-4">
                <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Duplicate waste</div>
                <div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{fmt(dupWasted)}</div>
                <div className="text-2xs text-[var(--text-tertiary)]">{dups.length} groups · {dupCount} files</div>
              </div>
              <div className="card p-4">
                <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Bloatware</div>
                <div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{bloatware.length}</div>
                <div className="text-2xs text-[var(--text-tertiary)]">{startup.filter((s) => s.impact >= 7).length} heavy startups</div>
              </div>
            </div>
          )}
          {!scanning && (
            <div className="mt-4 flex justify-end">
              <button className="btn-primary" onClick={() => go("clean")}>Review & clean →</button>
            </div>
          )}
        </Section>
      )}

      {/* ---- 3. Clean ---- */}
      {step === "clean" && (
        <Section title="Step 3 · Review & clean" subtitle="Pick what goes. Duplicate copies go to staging trash — reversible.">
          <div className="space-y-4">
            {/* Junk */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Junk files — {fmt(junkTotal)} available</div>
              <div className="space-y-1">
                {(junk?.items ?? []).map((j) => {
                  const skipped = skips[j.id];
                  return (
                    <div key={j.id} className={`rounded-lg border px-3 py-2 transition-colors ${skipped ? "border-[var(--border-default)] bg-[var(--surface-overlay)] opacity-70" : "bg-[var(--surface-overlay)]"}`}>
                      <div className="flex items-center gap-2.5">
                        <input type="checkbox" checked={junkSel.has(j.id)} disabled={j.admin_required || !!skipped} onChange={() => toggleJunk(j.id)} className="accent-[var(--accent-hex)]" />
                        <span className={`flex-1 text-xs ${j.admin_required || skipped ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}`}>{j.label}</span>
                        <span className="text-2xs text-[var(--text-tertiary)]">{fmt(j.size)}</span>
                        {j.admin_required && <span className="badge badge-neutral !text-2xs">needs admin</span>}
                        {skipped ? (
                          <button className="text-2xs text-[var(--text-secondary)] hover:underline" onClick={() => startSkip(j.id)}>
                            skipped: “{skipped}” ✎
                          </button>
                        ) : (
                          !j.admin_required && (
                            <button className="text-2xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]" onClick={() => startSkip(j.id)}>
                              skip why?
                            </button>
                          )
                        )}
                      </div>
                      {skipEditing === j.id && (
                        <div className="mt-2 flex gap-2 pl-7">
                          <input
                            autoFocus
                            className="input flex-1 !py-1.5 text-xs"
                            placeholder={`Why skip “${j.label}”? (shows up in the report)`}
                            value={skipDraft}
                            onChange={(e) => setSkipDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitSkip(j.id);
                              if (e.key === "Escape") setSkipEditing(null);
                            }}
                          />
                          <button className="btn-primary btn-sm" onClick={() => commitSkip(j.id)}>Save</button>
                          <button className="btn-ghost btn-sm" onClick={() => setSkipEditing(null)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(junk?.items.length ?? 0) === 0 && <div className="empty-state">No junk found.</div>}
              </div>
            </div>

            {/* Duplicates */}
            <div>
              <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">
                Duplicate copies — {fmt(dupWasted)} wasted (newest copy kept)
              </div>
              <div className="space-y-1">
                {dups.map((g) => {
                  const copies = removeCopies(g);
                  return (
                    <div key={`${g.name}|${g.size}`} className="rounded-lg bg-[var(--surface-overlay)] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={copies.every((p) => dupPaths.includes(p))} onChange={() => copies.forEach((p) => toggleDup(p))} className="accent-[var(--accent-hex)]" />
                        <span className="flex-1 truncate text-xs text-[var(--text-primary)]" title={g.name}>{g.name}</span>
                        <span className="text-2xs text-[var(--text-tertiary)]">{fmt(g.size)} × {g.files.length}</span>
                      </div>
                      {copies.length > 0 && (
                        <div className="mt-1 pl-6 text-2xs text-[var(--text-tertiary)]">
                          Will remove {copies.length} copy{copies.length > 1 ? "ies" : ""} to staging trash
                        </div>
                      )}
                    </div>
                  );
                })}
                {dups.length === 0 && <div className="empty-state">No duplicates found.</div>}
              </div>
            </div>

            {/* Bloatware */}
            {bloatware.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Pre-installed bloatware — review in Tune-up → Bloatware</div>
                <div className="flex flex-wrap gap-1.5">
                  {bloatware.map((b) => (
                    <span key={b.name} className="badge badge-neutral">{b.name}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-3">
              <span className="text-2xs text-[var(--text-tertiary)]">Selected: {junkSel.size} junk areas · {dupPaths.length} duplicate files</span>
              <button className="btn-primary" onClick={runClean} disabled={cleaning || (junkSel.size === 0 && dupPaths.length === 0)}>
                {cleaning ? "Cleaning…" : "Clean & continue →"}
              </button>
            </div>
            {cleanReport.length > 0 && (
              <div className="space-y-1">
                {cleanReport.map((r, i) => (
                  <div key={i} className="rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success)]">
                    <StatusDot status="success" /> {r}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ---- 4. Style ---- */}
      {step === "style" && (
        <Section title="Step 4 · Find your look" subtitle="Answer the style quiz — the top 3 are matched against every style in the library">
          {!quizDone ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wider text-[var(--text-tertiary)]">Question {quizStep + 1} of {QUIZ.length}</span>
                <button className="text-2xs text-[var(--text-tertiary)] hover:underline" onClick={resetQuiz}>Restart</button>
              </div>
              <div className="mb-4 h-1 overflow-hidden rounded-full bg-[var(--gray-4)]">
                <div className="h-full rounded-full bg-[var(--accent-hex)] transition-all" style={{ width: `${((quizStep + 1) / QUIZ.length) * 100}%` }} />
              </div>
              <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">{QUIZ[quizStep].q}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {QUIZ[quizStep].options.map((opt, i) => (
                  <button key={i} onClick={() => pickQuiz(i)} className="group rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3 text-left transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-hex)]">
                    <div className="text-sm font-medium text-[var(--text-primary)]">{opt.label}</div>
                    {opt.sub && <div className="mt-0.5 text-2xs text-[var(--text-tertiary)]">{opt.sub}</div>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">Your top 3 looks</h3>
                  <p className="text-2xs text-[var(--text-tertiary)]">Pick one, or build a style from your answers.</p>
                </div>
                <button className="btn-ghost btn-sm" onClick={resetQuiz}>Retake quiz</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {quizResults.map((s, i) => (
                  <div
                    key={s.id}
                    className="overflow-hidden rounded-xl border border-[var(--border-default)] transition-colors hover:border-[var(--border-accent)]"
                    onMouseEnter={() => setHoverQuiz(s.id)}
                    onMouseLeave={() => setHoverQuiz((h) => (h === s.id ? null : h))}
                  >
                    {/* C3 content preview — static gradient until hovered, then the style's animated scene plays */}
                    {hoverQuiz === s.id ? (
                      <div className="h-16 w-full overflow-hidden">
                        <ScenePreview kind={sceneConfigForStyle(s).kind} colors={sceneConfigForStyle(s).colors} speed={sceneConfigForStyle(s).speed} density={sceneConfigForStyle(s).density} className="h-full w-full" />
                      </div>
                    ) : (
                      // content preview — renders the actual gradient wallpaper
                      <div className="h-16 w-full" style={{ background: `linear-gradient(135deg, ${s.gradient[0]}, ${s.gradient[1]})` }} />
                    )}
                    <div className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="badge badge-accent !text-2xs">#{i + 1}</span>
                        <span className="truncate text-xs font-semibold text-[var(--text-primary)]" title={s.name}>{s.name}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-2xs text-[var(--text-tertiary)]" title={s.tagline}>{s.tagline}</div>
                      <div className="mt-2 flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.accent_hex }} />
                        <span className="text-2xs uppercase text-[var(--text-tertiary)]">{s.mode}</span>
                        {s.wallpaper.type === "live" && <span className="badge badge-accent !text-2xs">LIVE</span>}
                        {s.font && <span className="badge badge-neutral !text-2xs">font</span>}
                        {s.rgb && <span className="badge badge-neutral !text-2xs">RGB</span>}
                      </div>
                      <button className="btn-primary btn-sm mt-2.5 w-full" disabled={applyingStyle !== null} onClick={() => applyStyle(s)}>
                        {applyingStyle === s.id ? "Applying…" : appliedName === s.name ? "Applied ✓" : "Apply"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {myStyle && (
                <div className="mt-3 rounded-xl border border-[var(--border-accent)] bg-[var(--surface-selected)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">Or build my own — from your answers</div>
                      <div className="mt-0.5 truncate text-2xs text-[var(--text-tertiary)]" title={myStyle.description}>{myStyle.description}</div>
                    </div>
                    <button className="btn-primary btn-sm shrink-0" disabled={applyingStyle !== null} onClick={() => applyStyle(myStyle)}>
                      {applyingStyle === "my-style" ? "Applying…" : appliedName === myStyle.name ? "Applied ✓" : "Apply"}
                    </button>
                  </div>
                </div>
              )}
              {appliedName && (
                <div className="mt-4 flex justify-end">
                  <button className="btn-primary" onClick={() => advance(4)}>Finish →</button>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ---- 5. Done ---- */}
      {step === "done" && (
        <Section title="Step 5 · Done" subtitle="Your makeover summary">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Protection</div>
              <div className="mt-1 text-lg font-semibold text-[var(--status-success)]">{snapshotId ? "Snapshot active" : "Not taken"}</div>
              <div className="text-2xs text-[var(--text-tertiary)]">Restore anytime from History</div>
            </div>
            <div className="card p-4">
              <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Cleaned</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                {freedBytes > 0 ? fmt(freedBytes) + " junk" : "Nothing"}
              </div>
              <div className="text-2xs text-[var(--text-tertiary)]">{dupStagedCount} duplicate files staged to trash</div>
            </div>
            <div className="card p-4">
              <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Look</div>
              <div className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]" title={appliedName ?? "None applied"}>{appliedName ?? "None applied"}</div>
              <div className="text-2xs text-[var(--text-tertiary)]">Applied as one undoable entry</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-3">
            <div>
              <div className="text-sm font-medium text-[var(--status-danger)]">Changed your mind?</div>
              <div className="text-2xs text-[var(--text-tertiary)]">Restore everything to how it was before this session started.</div>
            </div>
            <button className="btn-danger shrink-0" onClick={revertEverything} disabled={busy}>
              {busy ? "Restoring…" : "Revert everything"}
            </button>
          </div>
          {Object.keys(skips).length > 0 && (
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
              <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Skipped — {Object.keys(skips).length} item(s), with reasons</div>
              <ul className="space-y-1">
                {Object.entries(skips).map(([id, reason]) => {
                  const label = junk?.items.find((j) => j.id === id)?.label ?? id;
                  return (
                    <li key={id} className="text-2xs text-[var(--text-tertiary)]">
                      · {label}: <span className="text-[var(--text-secondary)]">{reason}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" onClick={exportReport}>
              Export report (.md)
            </button>
            <button className="btn-ghost" onClick={() => go("clean")}>← Back to cleanup</button>
            <button className="btn-ghost" onClick={resetQuiz}>Retake style quiz</button>
          </div>
        </Section>
      )}
    </div>
  );
}

/** Duplicate copies to remove = every file except the newest (highest modified). */
function removeCopies(g: DuplicateGroup): string[] {
  if (g.files.length < 2) return [];
  const newest = Math.max(...g.files.map((f) => f.modified));
  return g.files.filter((f) => f.modified !== newest).map((f) => f.path);
}
