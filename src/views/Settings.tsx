import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorCopy, call, fmt, fmtAge, IS_TAURI, swallow } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { getVersion } from "@tauri-apps/api/app";
import type { AutomationConfig, BuildInfo, CapabilityMatrix, MaintenanceRun, ProfileExport, StagedUpdate, StorageConfig, StyleScheduleEntry, SystemInfo, TranscodeConfig, UpdateCheck, UpdateConfig } from "../lib/types";
import { InlineAlert, PageHeader, Section, SettingRow, StatusDot, Toggle, toast } from "../components/ui";
import { onAction } from "../lib/events";
import { ALL_STYLES } from "../styles";
import { buildStyleApplyPayload } from "../lib/styleApply";
import { IconDownload, IconUpload, IconPlus } from "../components/icons";
import { LANG_NAMES, LANGS, useI18n, type Lang } from "../i18n";

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const [exportPath, setExportPath] = useState("C:\\Users\\you\\.reforge-profile.json");
  const [importPath, setImportPath] = useState("");

  const [blueOn, setBlueOn] = useState(false);
  const [blueIntensity, setBlueIntensity] = useState(0.3);
  const [simpleMode, setSimpleMode] = useState(false);
  const [scale, setScale] = useState(100);

  // S11.1 — blue-light schedule (time-based with a 10-min ramp).
  const [blSchedule, setBlSchedule] = useState(false);
  const [blStart, setBlStart] = useState("19:00");
  const [blEnd, setBlEnd] = useState("07:00");
  // S11.3 — wall-clock style applies (morning/evening/any time).
  const [styleSchedule, setStyleSchedule] = useState<StyleScheduleEntry[]>([]);
  const [pickStyleId, setPickStyleId] = useState("");
  const [pickTime, setPickTime] = useState("18:00");
  // S11.6 — due-maintenance dashboard.
  const [runningMaintenance, setRunningMaintenance] = useState(false);

  // S12.1 — auto-updater: check → verified download → "restart to update" banner.
  const { data: updateCfg, refresh: refreshUpdateCfg } = useLoad<UpdateConfig>("get_update_config");
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [stagedUpdate, setStagedUpdate] = useState<StagedUpdate | null>(null);

  // S14.4 — Storage settings (thresholds, safe-list toggles, exclusions,
  // dry-run default, auto-clean schedule). Loaded once, edited locally, saved
  // on demand.
  const { data: storageCfg, refresh: refreshStorageCfg } = useLoad<StorageConfig>("get_storage_config");
  const [storageDraft, setStorageDraft] = useState<StorageConfig | null>(null);
  const [savingStorage, setSavingStorage] = useState(false);
  useEffect(() => {
    // shape-guard: some test mocks resolve unknown commands to [] — never
    // treat a non-config as a draft (same resilience as the Updates section)
    if (storageCfg && !storageDraft && typeof storageCfg.unused_days === "number") {
      setStorageDraft(storageCfg);
    }
  }, [storageCfg, storageDraft]);

  // ---- RGB lighting (E7.9) ----
  const [rgb, setRgb] = useState<RGBState | null>(null);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [rgbColor, setRgbColor] = useState("#6D7CFF");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  // S8.8 — transcode preset (video import quality/size budget).
  const { data: transcodeCfg, refresh: refreshTranscodeCfg } = useLoad<TranscodeConfig>("get_transcode_config");

  // S2.2 — system info + capabilities go through useLoad: real error
  // surfaces in their sections, one toast per command per session.
  const { data: sys, error: sysError } = useLoad<SystemInfo>("get_system_info");
  const { data: caps, error: capsError } = useLoad<CapabilityMatrix>("get_capability_matrix");
  // Automation drives the toggles below, so its failure must not silently
  // show all toggles off. useLoad + an InlineAlert on the section.
  const { data: automation, error: automationError, refresh: refreshAutomation } = useLoad<AutomationConfig>("get_automation_config");

  // Show the real binary version in native mode instead of a hardcoded string
  // that drifts from the shipped exe (B1.5). Falls back to package version —
  // cosmetic, so the dev-loud shim replaces the old silent blank.
  useEffect(() => {
    if (IS_TAURI) {
      getVersion().then(setAppVersion).catch((e) => swallow("getVersion", e));
      // S1.2 — real exe build date + commit, baked by build.rs.
      call<BuildInfo>("get_build_info").then(setBuildInfo).catch((e) => swallow("get_build_info", e));
    }
  }, []);

  // Keep blue-light slider + schedule + style-schedule state in sync with the
  // durable automation config (the blue-light scheduler thread also writes
  // blue_light_on, so refetching after every save keeps this honest).
  useEffect(() => {
    if (automation) {
      setBlueOn(automation.blue_light_on);
      setBlueIntensity(automation.blue_light_intensity);
      setBlSchedule(automation.blue_light_schedule);
      setBlStart(automation.blue_light_start || "19:00");
      setBlEnd(automation.blue_light_end || "07:00");
      setStyleSchedule(automation.style_schedule ?? []);
    }
  }, [automation]);

  // S12.1 — check for updates (user-initiated only; the app never phones
  // home on its own unless check_on_startup is enabled).
  const checkForUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const r = await call<UpdateCheck>("check_for_update");
      setUpdateCheck(r);
      if (r.state === "update-available" && r.notes.length) {
        toast(`Reforge ${r.latest} is available`);
      }
    } catch (e) {
      const msg = errorCopy(e);
      setUpdateCheck({ state: "error", current: appVersion, latest: null, url: null, sha256: null, notes: [], message: msg });
    } finally {
      setCheckingUpdate(false);
    }
  }, [appVersion]);

  const downloadUpdate = useCallback(async () => {
    if (!updateCheck || updateCheck.state !== "update-available" || !updateCheck.url || !updateCheck.sha256 || !updateCheck.latest) return;
    setDownloadingUpdate(true);
    try {
      const staged = await call<StagedUpdate>("download_update", {
        version: updateCheck.latest,
        url: updateCheck.url,
        sha256: updateCheck.sha256,
      });
      setStagedUpdate(staged);
      toast(`Update ${staged.version} downloaded and verified`);
    } catch (e) {
      errorCopy(e);
    } finally {
      setDownloadingUpdate(false);
    }
  }, [updateCheck]);

  // S14.4 — save the storage settings draft.
  const saveStorageCfg = useCallback(async () => {
    if (!storageDraft) return;
    setSavingStorage(true);
    try {
      await call<StorageConfig>("set_storage_config", { cfg: storageDraft });
      toast("Storage settings saved");
      refreshStorageCfg();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setSavingStorage(false);
    }
  }, [storageDraft, refreshStorageCfg]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${(scale / 100) * 16}px`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [scale]);

  useEffect(() => {
    document.body.classList.toggle("reforge-simple", simpleMode);
    return () => document.body.classList.remove("reforge-simple");
  }, [simpleMode]);

  // Merging a patch into component state is a data-loss bug: `automation` can
  // be stale (a second quick patch would clobber the first), and merging into
  // `{}` before the initial load drops every field. Base each merge on the
  // STORE's latest config (read-modify-write, chained through a queue so two
  // quick patches can't interleave and drop each other's writes).
  const automationQueue = useRef<Promise<void>>(Promise.resolve());
  const updateAutomation = async (patch: Partial<AutomationConfig>) => {
    const run = async () => {
      try {
        const latest = await call<AutomationConfig>("get_automation_config");
        const next = { ...AUTOMATION_DEFAULTS, ...latest, ...patch } as AutomationConfig;
        await call<AutomationConfig>("set_automation_config", { cfg: next });
        refreshAutomation();
      } catch (e) {
        toast(errorCopy(e), "err");
      }
    };
    automationQueue.current = automationQueue.current.then(run, run);
    await automationQueue.current;
  };

  const detectRgb = async () => {
    try {
      const s = await call<RGBState>("rgb_detect");
      setRgb(s);
      if (s.available && s.devices.length > 0) toast(`RGB: ${s.devices.length} device(s) found`);
      else toast(s.note || "No RGB devices detected", "err");
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const applyRgbColor = async () => {
    try {
      const msg = await call<string>("rgb_set_static", { device_index: deviceIndex, hex: rgbColor });
      toast(msg);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  // S10.5 — accent-sync: push the theme's live accent onto the device, the same
  // intent a style's `rgb: "accent-sync"` carries.
  const applyRgbAccent = async () => {
    try {
      const theme = await call<{ accent_hex: string }>("get_theme_state");
      const hex = theme.accent_hex;
      const msg = await call<string>("rgb_set_static", { device_index: deviceIndex, hex });
      setRgbColor(hex);
      toast(`${msg} — synced to your accent`);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const restoreRgb = async () => {
    try {
      const msg = await call<string>("rgb_restore_current_mode", { device_index: deviceIndex });
      toast(msg);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  // Auto-detect on mount is cosmetic — the Rescan button surfaces real
  // failures with a toast; the shim just keeps dev loud.
  useEffect(() => {
    call<RGBState>("rgb_detect").then(setRgb).catch((e) => swallow("rgb_detect mount", e));
  }, []);

  const exportProfile = useCallback(async () => {
    try {
      await call<ProfileExport>("export_profile");
      toast(`Profile exported (${fmt(0)} written to ${exportPath})`);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  }, [exportPath]);

  // Command palette → real export (B5)
  useEffect(() => onAction("export-profile", exportProfile), [exportProfile]);

  const importProfile = async () => {
    if (!importPath.trim()) return;
    try {
      const msg = await call<string>("import_profile", { path: importPath });
      toast(msg);
      setImportPath("");
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const toggleBlueLight = async (on: boolean) => {
    setBlueOn(on);
    await call("set_blue_light", { on, intensity: blueIntensity }).catch((e) => toast(errorCopy(e), "err"));
  };

  // ---- S11.3 — scheduled styles ----
  const addScheduledStyle = async () => {
    const s = ALL_STYLES.find((x) => x.id === pickStyleId);
    if (!s) return;
    try {
      const payload = await buildStyleApplyPayload(s);
      const entry: StyleScheduleEntry = {
        id: `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        time: pickTime,
        style_id: s.id,
        name: s.name,
        payload,
        last_fired_day: "",
      };
      const next = [...styleSchedule, entry];
      setStyleSchedule(next);
      updateAutomation({ style_schedule: next });
      setPickStyleId("");
      toast(`"${s.name}" scheduled for ${pickTime}`);
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const updateScheduledStyle = (id: string, patch: Partial<StyleScheduleEntry>) => {
    const next = styleSchedule.map((e) => (e.id === id ? { ...e, ...patch } : e));
    setStyleSchedule(next);
    updateAutomation({ style_schedule: next });
  };

  const removeScheduledStyle = (id: string) => {
    const next = styleSchedule.filter((e) => e.id !== id);
    setStyleSchedule(next);
    updateAutomation({ style_schedule: next });
  };

  // ---- S11.6 — run due maintenance now ----
  const runDueMaintenance = async () => {
    setRunningMaintenance(true);
    try {
      const r = await call<MaintenanceRun>("run_due_maintenance");
      const bits: string[] = [];
      if (r.ran_junk) bits.push(`junk freed ${fmt(r.junk_freed)}`);
      if (r.ran_dupes) bits.push(`dupes ${fmt(r.dupe_wasted)}`);
      if (r.reapplied_theme) bits.push("look re-applied");
      toast(bits.length ? `Maintenance complete — ${bits.join(", ")}` : "Nothing was due right now");
      refreshAutomation();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setRunningMaintenance(false);
    }
  };

  // Style picker options, grouped by tier (528 styles).
  const styleOptions = useMemo(
    () =>
      (["flagship", "library", "scene", "personal"] as const)
        .map((tier) => ({
          tier,
          items: ALL_STYLES.filter((s) => s.tier === tier).sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        }))
        .filter((g) => g.items.length > 0),
    [],
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Automation, display, accessibility, profile import/export"
      />

      {/* System info */}
      <Section bare title="System info" subtitle="Your PC at a glance">
        {sysError && <InlineAlert>{sysError}</InlineAlert>}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {sys ? (
            <>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
                <div className="text-xs text-[var(--text-tertiary)]">OS</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]" title={sys.os}>{sys.os}</div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
                <div className="text-xs text-[var(--text-tertiary)]">CPU</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]" title={sys.cpu_name}>
                  {sys.cpu_name.split(" ").slice(0, 3).join(" ")}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
                <div className="text-xs text-[var(--text-tertiary)]">RAM</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]" title={fmt(sys.ram_total)}>{fmt(sys.ram_total)}</div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
                <div className="text-xs text-[var(--text-tertiary)]">Disks</div>
                <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]" title={`${sys.disks.length} (${sys.disks.map((d) => d.name).join(", ")})`}>
                  {sys.disks.length} ({sys.disks.map((d) => d.name).join(", ")})
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">Loading system info…</p>
          )}
        </div>
      </Section>

      {/* Capability Matrix */}
      {capsError && <InlineAlert>{capsError}</InlineAlert>}
      {caps && (
        <Section bare title="System capabilities" subtitle="What this PC supports">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: "Windows 11", ok: caps.is_win11 },
              { label: "Admin access", ok: caps.admin },
              { label: "Secure Boot", ok: caps.secure_boot ?? false },
              { label: "Video wallpaper", ok: caps.video_wallpaper_supported },
              { label: "FFmpeg bundled", ok: caps.ffmpeg_available },
              { label: "Font substitution", ok: caps.font_substitution_supported },
              { label: "Lock screen policy", ok: caps.lockscreen_policy_supported },
              { label: "RGB support", ok: caps.rgb_supported },
              { label: "Taskbar reposition", ok: caps.taskbar_reposition_supported },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
                <StatusDot status={c.ok ? "success" : "neutral"} />
                <span className="text-xs text-[var(--text-secondary)]">{c.label}</span>
                <span className="ml-auto text-xs text-[var(--text-tertiary)]">{c.ok ? "Yes" : "No"}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            {caps.os_name} · Build {caps.build} · {caps.version_band}
            {caps.elevation_required_reason && (
              <span className="ml-2 text-[var(--status-warning)]">{caps.elevation_required_reason}</span>
            )}
          </p>
        </Section>
      )}

      {/* Automation */}
      <Section bare title={t("settings.automation")} subtitle={t("settings.automation.subtitle")}>
        {automationError && <InlineAlert>{automationError}</InlineAlert>}

        {/* S11.6 — maintenance dashboard: last-run status + next-run countdown
            + per-task toggles + run-now. The countdown mirrors the backend's
            first-run rule (a fresh config waits 24h before its first auto-run). */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">Weekly junk cleanup</span>
              <Toggle on={automation?.weekly_junk ?? false} onChange={(v) => updateAutomation({ weekly_junk: v })} label="Weekly junk cleanup" />
            </div>
            <div className="mt-1 text-2xs text-[var(--text-tertiary)]">
              {automation?.last_weekly_run ? `Last run ${fmtAge(automation.last_weekly_run)} · ` : "Never run · "}
              {maintenanceStatus(automation?.last_weekly_run ?? 0, automation?.created_at ?? 0, 7 * 86400_000)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">Monthly duplicate scan</span>
              <Toggle on={automation?.monthly_dupes ?? false} onChange={(v) => updateAutomation({ monthly_dupes: v })} label="Monthly duplicate scan" />
            </div>
            <div className="mt-1 text-2xs text-[var(--text-tertiary)]">
              {automation?.last_monthly_run ? `Last run ${fmtAge(automation.last_monthly_run)} · ` : "Never run · "}
              {maintenanceStatus(automation?.last_monthly_run ?? 0, automation?.created_at ?? 0, 30 * 86400_000)}
            </div>
          </div>
        </div>
        <div className="mt-2">
          <button className="btn-ghost btn-sm" onClick={runDueMaintenance} disabled={runningMaintenance}>
            {runningMaintenance ? "Running…" : "Run due maintenance now"}
          </button>
          <span className="ml-2 text-2xs text-[var(--text-tertiary)]">
            Also runs automatically when a task is due (runs stay in History).
          </span>
        </div>

        <div className="my-4 h-px bg-[var(--border-subtle)]" />

        <SettingRow
          title="Re-apply my look on login"
          description="Restore your accent, mode, transparency, font, sound and wallpaper style after Windows restarts"
          control={<Toggle on={automation?.auto_reapply_theme ?? false} onChange={(v) => updateAutomation({ auto_reapply_theme: v })} label="Re-apply my look on login" />}
        />

        <SettingRow
          title="Blue light filter"
          description={`Warm screen tint in the evening — intensity ${(blueIntensity * 100).toFixed(0)}%`}
          control={
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={blueIntensity}
                onChange={(e) => {
                  const v = +e.target.value;
                  setBlueIntensity(v);
                  // Persist the intensity even while off so it survives a reload
                  // and is ready the moment the filter is toggled on (A2.1).
                  call("set_blue_light", { on: blueOn, intensity: v }).catch((e) => swallow("set_blue_light slider", e));
                }}
                className="w-36"
                aria-label="Blue light intensity"
              />
              <Toggle on={blueOn} onChange={toggleBlueLight} disabled={blSchedule} label="Blue light filter" />
              {blSchedule && (
                <span className="text-2xs text-[var(--text-tertiary)]">follows your schedule</span>
              )}
            </div>
          }
        />

        {/* S11.1 — time-based blue light with a 10-min transition ramp. */}
        <SettingRow
          title="Blue light schedule"
          description="Turn the filter on/off automatically with a 10-minute gentle fade. Start after end = overnight (e.g. 19:00 → 07:00)."
          control={<Toggle on={blSchedule} onChange={(v) => { setBlSchedule(v); updateAutomation({ blue_light_schedule: v }); }} label="Blue light schedule" />}
        />
        {blSchedule && (
          <div className="mb-3 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="time"
              value={blStart}
              onChange={(e) => { setBlStart(e.target.value); updateAutomation({ blue_light_start: e.target.value }); }}
              className="input w-32"
              aria-label="Blue light start time"
            />
            <span>to</span>
            <input
              type="time"
              value={blEnd}
              onChange={(e) => { setBlEnd(e.target.value); updateAutomation({ blue_light_end: e.target.value }); }}
              className="input w-32"
              aria-label="Blue light end time"
            />
          </div>
        )}

        {/* S11.3 — wall-clock style applies (morning/evening/any time). */}
        <div className="mb-1 mt-4 text-sm font-medium text-[var(--text-primary)]">Scheduled styles</div>
        <p className="mb-2 text-2xs text-[var(--text-tertiary)]">
          Apply a style at a set time — a morning look, an evening look, anything. Each apply is one revertible History entry.
        </p>
        <div className="space-y-2">
          {styleSchedule.length === 0 && !automationError && (
            <p className="text-2xs text-[var(--text-tertiary)]">
              No scheduled styles yet. Pick a style and a time below.
            </p>
          )}
          {styleSchedule.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2">
              <input
                type="time"
                value={e.time}
                onChange={(ev) => updateScheduledStyle(e.id, { time: ev.target.value })}
                className="input w-32"
                aria-label={`Time for ${e.name}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]" title={e.name}>{e.name}</span>
              <button
                onClick={() => removeScheduledStyle(e.id)}
                className="shrink-0 text-2xs text-[var(--status-danger)] hover:underline"
                aria-label={`Remove scheduled style ${e.name}`}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pickStyleId}
              onChange={(e) => setPickStyleId(e.target.value)}
              className="h-8 max-w-64 rounded-[4px] border border-[#8A8A8A] bg-[var(--surface-base)] px-2 text-sm text-[var(--text-primary)]"
              aria-label="Style to schedule"
            >
              <option value="">Pick a style…</option>
              {styleOptions.map((g) => (
                <optgroup key={g.tier} label={g.tier[0].toUpperCase() + g.tier.slice(1)}>
                  {g.items.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              type="time"
              value={pickTime}
              onChange={(e) => setPickTime(e.target.value)}
              className="input w-32"
              aria-label="Scheduled style time"
            />
            <button className="btn-primary btn-sm" onClick={addScheduledStyle} disabled={!pickStyleId}>
              <IconPlus size={13} /> Schedule
            </button>
          </div>
        </div>
      </Section>

      {/* S8.8 — Video import quality */}
      <Section bare title="Video import quality" subtitle="Live wallpapers & style media are normalized on import — pick the size/quality budget">
        <SettingRow
          title="Transcode preset"
          description={(() => {
            const caps: Record<string, string> = {
              high: "1920p cap · ~8 Mbps max · best quality, biggest files",
              balanced: "1280p cap · ~5 Mbps max · the storage-aware default",
              performance: "960p cap · ~2.5 Mbps max · smallest files, fastest imports",
            };
            return caps[transcodeCfg?.preset ?? "balanced"] ?? caps.balanced;
          })()}
          control={
            <div className="flex flex-wrap gap-2">
              {(["high", "balanced", "performance"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    call<TranscodeConfig>("set_transcode_config", { config: { preset: p } })
                      .then(() => { refreshTranscodeCfg(); toast(`Video imports → ${p}`); })
                      .catch((e) => toast(errorCopy(e), "err"));
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${(transcodeCfg?.preset ?? "balanced") === p ? "border-[var(--accent-hex)] bg-[var(--accent-hex)]/10 text-[var(--text-primary)]" : "border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          }
        />
      </Section>

      {/* Profile Import/Export */}
      <Section bare title="Profile" subtitle="Export your look or import someone else's">
        <SettingRow
          title="Export profile"
          description="Save your current theme, wallpaper and settings as a .reforge pack"
          control={
            <div className="flex items-center gap-2">
              <input className="input w-64" value={exportPath} onChange={(e) => setExportPath(e.target.value)} aria-label="Export path" />
              <button className="btn-primary" onClick={exportProfile}>
                <IconDownload size={14} /> Export
              </button>
            </div>
          }
        />
        <SettingRow
          title="Import profile"
          description="Restore a look from a .reforge pack on disk"
          control={
            <div className="flex items-center gap-2">
              <input
                className="input w-64"
                placeholder="C:\path\to\profile.json"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                aria-label="Import path"
              />
              <button className="btn-ghost" onClick={importProfile} disabled={!importPath.trim()}>
                <IconUpload size={14} /> Import
              </button>
            </div>
          }
        />
      </Section>

      {/* RGB lighting (E7.9) */}
      <Section bare title="RGB lighting" subtitle="OpenRGB devices — sync hardware with your accent">
        <SettingRow
          title="Device detection"
          description={
            rgb
              ? rgb.available && rgb.devices.length > 0
                ? `${rgb.devices.length} RGB device${rgb.devices.length > 1 ? "s" : ""} found`
                : rgb.note || "No RGB devices detected"
              : "Scan for OpenRGB-compatible controllers…"
          }
          control={<button className="btn-ghost" onClick={detectRgb}>Rescan</button>}
        />
        {rgb?.available && rgb.devices.length > 0 && (
          <>
            <SettingRow
              title="Device"
              description="Choose which controller to control"
              control={
                <select value={deviceIndex} onChange={(e) => setDeviceIndex(+e.target.value)}>
                  {rgb.devices.map((d) => (
                    <option key={d.index} value={d.index}>{d.name}</option>
                  ))}
                </select>
              }
            />
            <SettingRow
              title="Static color"
              description="Set this device to a solid color"
              control={
                <div className="flex items-center gap-2">
                  {["#6D7CFF", "#FF2E88", "#34D399", "#E8590C", "#22B8CF", "#FFFFFF"].map((c) => (
                    <button
                      key={c}
                      onClick={() => setRgbColor(c)}
                      className={`h-6 w-6 rounded-sm transition hover:scale-110 ${rgbColor.toLowerCase() === c ? "ring-2 ring-[var(--accent-hex)] ring-offset-1" : ""}`}
                      style={{ background: c }}
                      aria-label={`RGB ${c}`}
                    />
                  ))}
                  <input type="color" value={rgbColor} onChange={(e) => setRgbColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded-sm border-0 bg-transparent" aria-label="Custom RGB color" />
                  <button className="btn-ghost" onClick={applyRgbAccent} title="Set this device to your current theme accent">Accent-sync</button>
                  <button className="btn-primary" onClick={applyRgbColor}>Apply</button>
                </div>
              }
            />
            <SettingRow
              title="Restore current mode"
              description="Return the device to its original lighting mode"
              control={<button className="btn-ghost" onClick={restoreRgb}>Restore</button>}
            />
          </>
        )}
      </Section>

      {/* Accessibility */}
      <Section bare title="Accessibility" subtitle="Text scaling, simplified mode, and UI density">
        <SettingRow
          title="Text scale"
          description="Enlarge or shrink text throughout Reforge"
          control={
            <div className="w-48">
              <input
                type="range"
                min={80}
                max={150}
                step={5}
                value={scale}
                onChange={(e) => setScale(+e.target.value)}
                className="w-full"
                aria-label="Text scale"
              />
              <div className="mt-1 flex justify-between text-xs text-[var(--text-tertiary)]">
                <span>80%</span>
                <span>{scale}%</span>
                <span>150%</span>
              </div>
            </div>
          }
        />
        <SettingRow
          title="Simplified mode"
          description="Larger touch targets, bigger text, reduced visual density"
          control={<Toggle on={simpleMode} onChange={setSimpleMode} label="Simplified mode" />}
        />
      </Section>

      {/* Roadmap */}
      <Section bare title="Roadmap" subtitle="What's coming next">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { title: "Windows FX", desc: "Blur, transparency & rounded corner control via registry." },
            { title: "Right-click cleaner", desc: "Tidy context menus with backup + revert." },
            { title: "Folder color-coding", desc: "Custom folder icons via desktop.ini." },
            { title: "Screensaver studio", desc: "Turn animated scenes into .scr screensavers." },
            { title: "Login / boot skinning", desc: "OS-blocked in Win11 — needs third-party tooling." },
            { title: "Multi-file pack format", desc: ".reforge single-file archives with checksums." },
          ].map((r) => (
            <div key={r.title} className="card p-4">
              <div className="text-sm font-medium text-[var(--text-primary)]">{r.title}</div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">{r.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Updates (S12.1) */}
      <Section bare title={t("settings.updates")} subtitle={t("settings.updates.subtitle")}>
        <SettingRow
          title={t("settings.updates.checkOnStartup")}
          description={t("settings.updates.checkOnStartup.desc")}
          control={
            <Toggle
              on={updateCfg?.check_on_startup ?? false}
              onChange={(v) => {
                if (!updateCfg) return;
                call<UpdateConfig>("set_update_config", { cfg: { ...updateCfg, check_on_startup: v } })
                  .then(refreshUpdateCfg)
                  .catch((e) => errorCopy(e));
              }}
              label={t("settings.updates.checkOnStartup")}
            />
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary btn-sm" onClick={checkForUpdate} disabled={checkingUpdate}>
            {checkingUpdate ? t("settings.updates.checking") : t("settings.updates.check")}
          </button>
          {updateCfg && (
            <span className="font-mono text-xs text-[var(--text-tertiary)]">{updateCfg.manifest_url}</span>
          )}
        </div>

        {updateCheck?.state === "update-available" && (
          <div className="card mt-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {t("settings.updates.available", { version: updateCheck.latest!, current: updateCheck.current })}
                </div>
                {updateCheck.notes.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-[var(--text-tertiary)]">
                    {updateCheck.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
              {stagedUpdate ? (
                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium text-[var(--accent)]">{t("settings.updates.verified")}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{t("settings.updates.silentInstall")}</div>
                </div>
              ) : (
                <button className="btn-primary btn-sm shrink-0" onClick={downloadUpdate} disabled={downloadingUpdate}>
                  {downloadingUpdate ? t("settings.updates.downloading") : t("settings.updates.download")}
                </button>
              )}
            </div>
          </div>
        )}
        {updateCheck?.state === "up-to-date" && (
          <div className="mt-3 text-xs text-[var(--text-tertiary)]">{t("settings.updates.upToDate", { version: updateCheck.current })}</div>
        )}
        {updateCheck?.state === "error" && updateCheck.message && (
          <div className="mt-3">
            <InlineAlert kind="warning">Couldn't check for updates — {updateCheck.message}</InlineAlert>
          </div>
        )}
      </Section>

      {/* Storage (S14.4) */}
      <Section bare title="Storage" subtitle="Safe-clean rules, unused thresholds, exclusions, auto-clean">
        {storageDraft && typeof storageDraft.unused_days === "number" ? (
          <>
            <SettingRow
              title="Unused-file threshold"
              description="Files untouched longer than this count as 'unused' in the Organize scan (last-changed is the honest proxy)"
              control={
                <div className="flex items-center gap-2">
                  <input
                    className="input w-24"
                    type="number"
                    min={1}
                    value={storageDraft.unused_days}
                    onChange={(e) => setStorageDraft({ ...storageDraft, unused_days: Math.max(1, Number(e.target.value) || 1) })}
                    aria-label="Unused days"
                  />
                  <span className="text-xs text-[var(--text-tertiary)]">days</span>
                  <input
                    className="input w-24"
                    type="number"
                    min={1}
                    value={storageDraft.unused_min_mb}
                    onChange={(e) => setStorageDraft({ ...storageDraft, unused_min_mb: Math.max(1, Number(e.target.value) || 1) })}
                    aria-label="Minimum size MB"
                  />
                  <span className="text-xs text-[var(--text-tertiary)]">min MB</span>
                </div>
              }
            />
            <SettingRow
              title="Dry run before delete"
              description="Preview what would be freed and delete nothing until you confirm"
              control={
                <Toggle
                  on={storageDraft.dry_run}
                  label="Dry run"
                  onChange={(v) => setStorageDraft({ ...storageDraft, dry_run: v })}
                />
              }
            />
            <SettingRow
              title="Safe list"
              description="Which categories the one-click safe clean may touch"
              control={
                <div className="flex flex-col gap-2">
                  {([
                    ["safe_temp", "Temp & crash files"],
                    ["safe_update_cache", "Windows Update cache"],
                    ["safe_recycle_bin", "Recycle Bin"],
                    ["safe_browser_caches", "Browser caches"],
                    ["safe_installers", "Old installers"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Toggle
                        on={storageDraft[key]}
                        label={label}
                        onChange={(v) => setStorageDraft({ ...storageDraft, [key]: v })}
                      />
                      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
                    </div>
                  ))}
                </div>
              }
            />
            <SettingRow
              title="Exclusions"
              description="Paths never touched by any clean — one per line"
              control={
                <textarea
                  className="input h-24 w-full resize-y"
                  value={storageDraft.exclusions.join("\n")}
                  onChange={(e) =>
                    setStorageDraft({
                      ...storageDraft,
                      exclusions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  aria-label="Excluded paths"
                />
              }
            />
            <SettingRow
              title="Auto-clean schedule"
              description="Run the safe clean on a schedule (via the existing maintenance runner)"
              control={
                <select
                  value={storageDraft.auto_clean}
                  onChange={(e) =>
                    setStorageDraft({ ...storageDraft, auto_clean: e.target.value as StorageConfig["auto_clean"] })
                  }
                  className="h-8 rounded-[4px] border border-[#8A8A8A] bg-[var(--surface-base)] px-2 text-sm text-[var(--text-primary)]"
                  aria-label="Auto-clean schedule"
                >
                  <option value="off">Off</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              }
            />
            <div className="flex justify-end">
              <button className="btn-primary" onClick={saveStorageCfg} disabled={savingStorage}>
                {savingStorage ? "Saving…" : "Save storage settings"}
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">Loading storage settings…</div>
        )}
      </Section>

      {/* About */}
      <Section bare title={t("settings.about")}>
        <SettingRow
          title={t("settings.language")}
          description={t("settings.language.desc")}
          control={
            <select
              aria-label={t("settings.language")}
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="h-8 rounded-[4px] border border-[#8A8A8A] bg-[var(--surface-base)] px-2 text-sm text-[var(--text-primary)] transition-colors duration-100 hover:border-[#5C5C5C]"
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          }
        />
        <div className="space-y-2 text-sm text-[var(--text-tertiary)]">
          <div>
            <span className="text-[var(--text-secondary)]">{t("settings.about.version", { version: appVersion })}</span> · Tauri {IS_TAURI ? "(native)" : "(browser preview)"}
          </div>
          <div>{t("settings.about.localFirst")}</div>
          <div className="text-xs">{t("settings.about.built")}</div>
          {buildInfo && (
            <div className="border-t border-[var(--border-subtle)] pt-2 text-xs">
              {buildInfo.build_ts
                ? <>{t("settings.about.exeBuilt", { date: new Date(buildInfo.build_ts * 1000).toLocaleString() })}</>
                : t("settings.about.exeBuiltUnknown")}
              {buildInfo.git_hash ? <> · {t("settings.about.commit", { hash: buildInfo.git_hash })} <span className="font-mono">{buildInfo.git_hash}</span></> : null}
              {buildInfo.exe_path ? (
                <>
                  {" "}· <span className="break-all text-[var(--text-tertiary)]">{buildInfo.exe_path}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

/** Full default automation config — mirrors Rust `AutomationConfig::default()`
 *  so partial updates never drop fields (see updateAutomation). */
const AUTOMATION_DEFAULTS: AutomationConfig = {
  weekly_junk: true,
  monthly_dupes: false,
  auto_reapply_theme: true,
  last_weekly_run: 0,
  last_monthly_run: 0,
  blue_light_on: false,
  blue_light_intensity: 0.3,
  blue_light_schedule: false,
  blue_light_start: "19:00",
  blue_light_end: "07:00",
  style_schedule: [],
  created_at: 0,
};

/** S11.6 — next-run countdown text, mirroring the backend's first-run rule:
 *  a fresh config (last run 0) waits 24h after creation before its first
 *  auto-run; afterwards it's last-run + interval. */
function maintenanceStatus(lastRun: number, createdAt: number, intervalMs: number): string {
  const next =
    lastRun === 0
      ? createdAt === 0
        ? null
        : createdAt + 24 * 3600 * 1000
      : lastRun + intervalMs;
  if (next === null) return "next run unknown";
  const diff = next - Date.now();
  if (diff <= 0) return "due now";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `next in ${d}d ${h}h`;
  if (h > 0) return `next in ${h}h ${m}m`;
  return `next in ${Math.max(1, m)}m`;
}

// ---- RGB lighting types (mirror rgb.rs) ----
interface RGBDevice {
  index: number;
  name: string;
  kind: number;
  num_leds: number;
  num_modes: number;
  active_mode: number;
  colors: number[][];
}
interface RGBState {
  available: boolean;
  devices: RGBDevice[];
  note: string;
}
