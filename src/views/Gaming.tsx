import { useEffect, useRef, useState } from "react";
import { errorCopy, call, swallow } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { applyStyleDef } from "../lib/styleApply";
import { ALL_STYLES, getStyle } from "../styles";
import type { GameProfile, PerfSnapshot, StreamLayoutState } from "../lib/types";
import { InlineAlert, Section, StatusDot, Toggle, toast } from "../components/ui";
import { fmtUptime } from "../components/charts";
import { IconGamepad, IconCpu, IconHardDrive, IconMonitor, IconBattery, IconGauge, IconPlus, IconTrash } from "../components/icons";

// S10.4 — the look applied while game mode is on (a focused dark flagship).
const FOCUSED_DARK_STYLE = ALL_STYLES.find((s) => s.mood === "focused" && s.mode === "dark");

export default function Gaming() {
  // S2.2 — toggles load through useLoad: real error surface, one toast per
  // command per session on first failure.
  const { data: gameMode, error: gameModeError, refresh: refreshGameMode } = useLoad<boolean>("get_game_mode");
  const { data: stream, error: streamError, refresh: refreshStream } = useLoad<StreamLayoutState>("get_stream_layout");
  const [snap, setSnap] = useState<PerfSnapshot | null>(null);

  // Live stats for the overlay preview — real data, not a static mock (kills
  // the old "coming soon" placeholder copy).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const s = await call<PerfSnapshot>("get_performance");
        if (alive) setSnap(s);
      } catch (e) {
        swallow("get_performance poll", e); /* keep polling */
      }
      window.setTimeout(tick, 2000);
    };
    tick();
    return () => {
      alive = false;
    };
  }, []);

  // S10.4 — game-mode style swap: entering a game with the swap on applies a
  // focused dark look; leaving restores the previous one. Both applies go
  // through the normal (undoable) style path, so History can revert either.
  const [swapLook, setSwapLook] = useState<boolean>(() => localStorage.getItem("reforge-swap-look") === "1");
  const swapLookRef = useRef<string | null>(null);
  const setSwapLookAndSave = (v: boolean) => {
    setSwapLook(v);
    localStorage.setItem("reforge-swap-look", v ? "1" : "0");
  };

  const toggleGameMode = async (on: boolean) => {
    if (on && swapLook) {
      try {
        swapLookRef.current = await call<string | null>("get_applied_style");
        if (FOCUSED_DARK_STYLE) {
          const res = await applyStyleDef(FOCUSED_DARK_STYLE);
          toast(`Applied “${res.name}” while gaming — revert from History`);
        }
      } catch { /* the swap is best-effort; game mode still toggles */ }
    } else if (!on && swapLookRef.current) {
      const beforeId = swapLookRef.current;
      swapLookRef.current = null;
      const before = beforeId ? getStyle(beforeId) : undefined;
      if (before) {
        try {
          await applyStyleDef(before);
          toast("Restored your previous look");
        } catch { /* ignore */ }
      }
    }
    call("set_game_mode", { on })
      .then(() => {
        toast(`Game Mode ${on ? "on" : "off"}`);
        refreshGameMode();
      })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  // ---- S10.3 per-game profiles ----
  const { data: profiles, error: profilesError, refresh: refreshProfiles } = useLoad<GameProfile[]>("list_game_profiles");
  const [newProfile, setNewProfile] = useState<GameProfile>({
    id: "", exe: "", name: "", game_mode: true, scene_pause: true, priority: "normal", overlay: false,
  });

  const saveProfile = () => {
    if (!newProfile.exe.trim()) return;
    call<GameProfile>("save_game_profile", { profile: newProfile })
      .then(() => { toast("Profile saved — applies automatically when the game launches"); refreshProfiles(); setNewProfile({ ...newProfile, exe: "", name: "" }); })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const applyProfile = (p: GameProfile) => {
    call<string>("apply_game_profile", { profile: p })
      .then((m) => { toast(m); refreshGameMode(); refreshStream(); })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const deleteProfile = (id: string) => {
    call("delete_game_profile", { id })
      .then(() => { toast("Profile deleted"); refreshProfiles(); })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const toggleStream = (on: boolean) => {
    call("set_stream_layout", { on })
      .then(() => {
        toast(on ? "Stream-safe layout on — clean desktop" : "Desktop restored");
        refreshStream();
      })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const streamSafe = stream ?? { icons_hidden: false, taskbar_autohide: false };
  const gameModeOn = gameMode ?? false;

  return (
    <div className="space-y-4">
      <div className="page-head flex items-end justify-between">
        <div>
          <h1 className="page-title">Gaming</h1>
          <p className="page-subtitle">
            Game mode, stream-safe layout, overlay & RGB roadmap
          </p>
        </div>
        {gameModeOn && (
          <div className="badge badge-accent">
            <StatusDot status="success" pulse />
            <span className="ml-1.5">Game Mode Active</span>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Game Mode"
          subtitle="Windows prioritizes your game over background work"
        >
          {gameModeError && <InlineAlert>{gameModeError}</InlineAlert>}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${gameModeOn ? "bg-[var(--gray-4)]" : "bg-[var(--surface-overlay)]"}`}>
                <IconGamepad size={18} className={gameModeOn ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"} />
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  {gameModeOn ? "Game Mode is on" : "Game Mode is off"}
                </div>
                <div className="text-2xs text-[var(--text-tertiary)]">
                  Suspends notifications & background updates during play
                </div>
              </div>
            </div>
            <Toggle on={gameModeOn} onChange={toggleGameMode} />
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2">
            <div>
              <div className="text-xs font-medium text-[var(--text-primary)]">Focused dark look while gaming</div>
              <div className="text-2xs text-[var(--text-tertiary)]">Entering a game applies {FOCUSED_DARK_STYLE ? `“${FOCUSED_DARK_STYLE.name}”` : "a focused dark style"}; leaving restores your previous look. Both are undoable from History.</div>
            </div>
            <Toggle on={swapLook} onChange={setSwapLookAndSave} />
          </div>
          {gameModeOn && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { icon: <IconCpu size={14} />, label: "CPU priority", value: "High" },
                { icon: <IconHardDrive size={14} />, label: "Background I/O", value: "Reduced" },
                { icon: <IconMonitor size={14} />, label: "Notifications", value: "Suppressed" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-[var(--surface-overlay)] p-2 text-center">
                  <div className="mx-auto mb-1 w-fit text-[var(--text-secondary)]">{item.icon}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">{item.label}</div>
                  <div className="text-2xs font-medium text-[var(--status-success)]">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Stream-safe layout" subtitle="Hide private stuff before you go live">
          {streamError && <InlineAlert>{streamError}</InlineAlert>}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-[var(--text-primary)]">
                {streamSafe.icons_hidden ? "Clean layout active" : "Icons + taskbar visible"}
              </div>
              <div className="text-2xs text-[var(--text-tertiary)]">
                Hides desktop icons and auto-hides the taskbar for streaming.
              </div>
            </div>
            <Toggle on={streamSafe.icons_hidden} onChange={toggleStream} />
          </div>
          {streamSafe.icons_hidden && (
            <div className="mt-3 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] p-2 text-center">
              <div className="flex items-center justify-center gap-2 text-2xs text-[var(--status-success)]">
                <StatusDot status="success" pulse />
                Clean layout active — desktop icons hidden, taskbar auto-hides
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* S10.3 — per-game profiles */}
      <Section title="Game profiles" subtitle="Per-game optimizations — game mode, scene pause, priority & clean layout, applied automatically on launch">
        {profilesError && <InlineAlert>{profilesError}</InlineAlert>}
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Game executable
            <input
              placeholder="eldenring.exe"
              value={newProfile.exe}
              onChange={(e) => setNewProfile({ ...newProfile, exe: e.target.value })}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Display name (optional)
            <input
              placeholder="Elden Ring"
              value={newProfile.name}
              onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
          <label className="flex items-center gap-2"><Toggle on={newProfile.game_mode} onChange={(v) => setNewProfile({ ...newProfile, game_mode: v })} /> Game mode</label>
          <label className="flex items-center gap-2"><Toggle on={newProfile.scene_pause} onChange={(v) => setNewProfile({ ...newProfile, scene_pause: v })} /> Pause scene</label>
          <label className="flex items-center gap-2"><Toggle on={newProfile.priority === "high"} onChange={(v) => setNewProfile({ ...newProfile, priority: v ? "high" : "normal" })} /> High priority</label>
          <label className="flex items-center gap-2"><Toggle on={newProfile.overlay} onChange={(v) => setNewProfile({ ...newProfile, overlay: v })} /> Clean layout</label>
          <button className="btn-primary ml-auto" onClick={saveProfile}><IconPlus size={12} /> Add profile</button>
        </div>
        {(profiles ?? []).length === 0 ? (
          <div className="empty-state">No profiles yet — add one above and it applies whenever that game launches.</div>
        ) : (
          <div className="space-y-2">
            {(profiles ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2">
                <div className="flex-1">
                  <div className="text-xs font-medium text-[var(--text-primary)]">{p.name || p.exe}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">
                    {p.exe} · {p.game_mode ? "game mode" : ""} {p.scene_pause ? "· scene pause" : ""} {p.priority === "high" ? "· high priority" : ""} {p.overlay ? "· clean layout" : ""}
                  </div>
                </div>
                <button className="btn-ghost text-2xs" onClick={() => applyProfile(p)}>Apply now</button>
                <button title="Delete profile" className="text-[var(--text-tertiary)] hover:text-[var(--status-danger)]" onClick={() => deleteProfile(p.id)}><IconTrash size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Performance overlay preview — live data */}
      <Section title="Performance Overlay" subtitle="Live PC stats, refreshed every 2s — rendering on top of fullscreen games is next on the roadmap">
        <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4">
          {/* Live overlay preview */}
          <div className="flex items-start justify-between">
            <div className="space-y-1.5 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-2xs">
                <IconCpu size={10} className="text-[var(--status-success)]" />
                <span className="text-[var(--status-success)]">{snap ? `${snap.cpu_usage_pct.toFixed(0)}%` : "…"}</span>
                <span className="text-white/40">CPU</span>
              </div>
              <div className="flex items-center gap-2 text-2xs">
                <IconHardDrive size={10} className="text-[var(--text-secondary)]" />
                <span className="text-[var(--text-secondary)]">{snap ? `${snap.ram_free_pct.toFixed(0)}%` : "…"}</span>
                <span className="text-white/40">RAM free</span>
              </div>
              <div className="flex items-center gap-2 text-2xs">
                <IconBattery size={10} className="text-[var(--status-warning)]" />
                <span className="text-[var(--status-warning)]">{snap?.battery ? `${snap.battery.percent}%` : "—"}</span>
                <span className="text-white/40">Battery</span>
              </div>
              <div className="flex items-center gap-2 text-2xs">
                <IconGauge size={10} className="text-[var(--status-success)]" />
                <span className="text-[var(--status-success)]">{snap ? `${snap.process_count}` : "…"}</span>
                <span className="text-white/40">procs</span>
              </div>
            </div>
            <div className="rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
              <div className="text-2xs text-white/40">Uptime</div>
              <div className="text-xs font-medium text-white">{snap ? fmtUptime(snap.uptime_secs) : "…"}</div>
            </div>
          </div>
          <div className="mt-3 text-center text-2xs text-white/30">
            Live preview — the on-screen overlay will render on top of fullscreen games
          </div>
        </div>
      </Section>

      {/* Roadmap items */}
      <Section title="Coming soon" subtitle="Features on the roadmap for gaming enthusiasts">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { title: "RGB Controller", desc: "Sync keyboard, mouse, and ambient lighting with your current look via OpenRGB.", done: true },
            { title: "Peripheral Profiles", desc: "Auto-switch mouse DPI, keyboard lighting, and audio profiles per game.", done: false },
            { title: "Notification Manager", desc: "Per-app notification blocking with scheduled allow-lists.", done: false },
            { title: "Game profiles", desc: "Per-game optimizations applied automatically on launch.", done: true },
          ].map((r) => (
            <div key={r.title} className={`card p-3 ${r.done ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-[var(--text-primary)]">{r.title}</div>
                {r.done && (
                  <span className="badge badge-success">Live in Settings</span>
                )}
              </div>
              <p className="mt-1 text-2xs text-[var(--text-tertiary)]">{r.desc}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
