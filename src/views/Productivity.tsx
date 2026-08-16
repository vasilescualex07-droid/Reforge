import { useEffect, useState } from "react";
import { errorCopy, call, fmtAge } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { AppEntry, ClipItem, FocusSession, MacroRule } from "../lib/types";
import { InlineAlert, Modal, Section, Toggle, toast } from "../components/ui";
import { IconSearch, IconCopy, IconPin, IconPlus, IconTrash, IconPower, IconTimer } from "../components/icons";

export default function Productivity() {
  const [appQuery, setAppQuery] = useState("");
  const [clipQuery, setClipQuery] = useState("");
  const [macroOpen, setMacroOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mApp, setMApp] = useState("");
  const [mLook, setMLook] = useState("Midnight Rain");
  const [copyMsg, setCopyMsg] = useState("");

  // S2.2 — every section's load goes through useLoad: real error surface,
  // one toast per command per session on first failure.
  const { data: apps, error: appsError } = useLoad<AppEntry[]>("get_app_list");
  const { data: clips, error: clipsError, refresh: refreshClips } = useLoad<ClipItem[]>("get_clipboard_history");
  const { data: macros, error: macrosError, refresh: refreshMacros } = useLoad<MacroRule[]>("list_macros");
  const { data: focusOn, error: focusError, refresh: refreshFocus } = useLoad<boolean>("get_focus_state");

  // ---- S10.6 focus sessions ----
  const { data: session, refresh: refreshSession } = useLoad<FocusSession>("get_focus_session");
  const [duration, setDuration] = useState(25);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sessionActive = session?.active ?? false;
  const remainingSecs = sessionActive ? Math.max(0, Math.floor(((session?.ends_at_ts ?? 0) - now) / 1000)) : 0;

  useEffect(() => {
    if (!sessionActive) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sessionActive]);

  const startSession = () => {
    setSessionBusy(true);
    call<FocusSession>("start_focus_session", { minutes: duration })
      .then(() => { refreshSession(); setNow(Date.now()); toast(`Focus session started — ${duration} min. Icons hidden, notifications muted.`); })
      .catch((e) => toast(errorCopy(e), "err"))
      .finally(() => setSessionBusy(false));
  };

  const stopSession = () => {
    setSessionBusy(true);
    call<string>("stop_focus_session")
      .then((m) => { refreshSession(); toast(String(m)); })
      .catch((e) => toast(errorCopy(e), "err"))
      .finally(() => setSessionBusy(false));
  };

  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const launch = (p: string, n: string) => {
    call("launch_app", { path: p })
      .then(() => toast(`Launching ${n}`))
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const copyClip = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg("Copied to clipboard");
      setTimeout(() => setCopyMsg(""), 2000);
    } catch {
      toast("Clipboard write blocked in this browser preview", "err");
    }
  };

  const createMacro = () => {
    if (!mName.trim() || !mApp.trim()) {
      toast("Give the macro a name and an app", "err");
      return;
    }
    const looks: Record<string, { accent: string; mode: string }> = {
      "Midnight Rain": { accent: "#6D7CFF", mode: "dark" },
      "Retro Wave": { accent: "#FF2E88", mode: "dark" },
      "Forest Calm": { accent: "#34D399", mode: "dark" },
    };
    const look = looks[mLook] ?? looks["Midnight Rain"];
    call<MacroRule>("create_macro", {
      name: mName,
      when_app: mApp,
      look_name: mLook,
      accent: look.accent,
      mode: look.mode,
      wallpaper: "",
    })
      .then(() => {
        setMacroOpen(false);
        setMName("");
        setMApp("");
        toast(`Macro created: when ${mApp} starts → apply ${mLook}`);
        refreshMacros();
      })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const toggleMacro = (m: MacroRule) => {
    call<MacroRule[]>("toggle_macro", { id: m.id, enabled: !m.enabled })
      .then(() => refreshMacros())
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const removeMacro = (m: MacroRule) => {
    call("remove_macro", { id: m.id })
      .then(() => refreshMacros())
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const toggleFocus = (on: boolean) => {
    call("set_focus_mode", { on })
      .then((m) => { refreshFocus(); toast(m as string); })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const filteredApps = (apps ?? []).filter(
    (a) => !appQuery || a.name.toLowerCase().includes(appQuery.toLowerCase())
  );
  const filteredClips = (clips ?? []).filter(
    (c) => !clipQuery || c.text.toLowerCase().includes(clipQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <header className="page-head flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Productivity</h1>
          <p className="page-subtitle">
            Launcher, clipboard history, macros, focus mode
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconPower size={14} className={focusOn ? "text-[var(--status-success)]" : "text-[var(--text-tertiary)]"} />
          <span className="text-xs text-[var(--text-tertiary)]">Focus</span>
          <Toggle on={focusOn ?? false} onChange={toggleFocus} />
          {focusError && <span className="text-2xs text-[var(--status-danger)]">Focus state unavailable</span>}
        </div>
      </header>

      {/* S10.6 — focus sessions: a real timer with do-not-disturb + widget countdown */}
      <Section
        title="Focus session"
        subtitle="A real timer — hides desktop icons, mutes notifications, and shows the countdown on your clock widget. Undoable from History."
        actions={sessionActive ? (
          <button className="btn-danger" onClick={stopSession} disabled={sessionBusy}><IconPower size={12} /> End session</button>
        ) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          {[25, 45, 90].map((m) => (
            <button
              key={m}
              onClick={() => setDuration(m)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${duration === m ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}
            >
              {m} min
            </button>
          ))}
          {!sessionActive && (
            <button className="btn-primary" onClick={startSession} disabled={sessionBusy}><IconTimer size={13} /> Start</button>
          )}
        </div>
        {sessionActive ? (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-3">
            <IconTimer size={20} className="text-[var(--status-success)]" />
            <div>
              <div className="font-mono text-2xl font-bold text-[var(--status-success)]">{fmtCountdown(remainingSecs)}</div>
              <div className="text-2xs text-[var(--text-tertiary)]">Focusing · desktop icons hidden · notifications muted · countdown live on the clock widget</div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-2xs text-[var(--text-tertiary)]">
            The desktop auto-restores when the timer ends — or end it early above.
          </p>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* App Launcher */}
        <Section
          title="App launcher"
          subtitle="Quick-launch any installed app"
          actions={appsError ? undefined : (
            <div className="relative">
              <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                className="input !pl-8 !w-40"
                placeholder="Search…"
                value={appQuery}
                onChange={(e) => setAppQuery(e.target.value)}
              />
            </div>
          )}
        >
          {appsError && <InlineAlert>{appsError}</InlineAlert>}
          <div className="space-y-1.5">
            {filteredApps.map((a) => (
              <div
                key={a.name}
                className="flex items-center gap-3 rounded-lg bg-[var(--surface-overlay)] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{a.name}</div>
                </div>
                <button className="btn-ghost btn-sm" onClick={() => launch(a.path, a.name)}>
                  Launch
                </button>
              </div>
            ))}
            {filteredApps.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No apps found.</p>}
          </div>
        </Section>

        {/* Clipboard History */}
        <Section
          title="Clipboard history"
          subtitle="Pinned and recent clipboard entries"
          actions={
            <div className="relative">
              <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                className="input !pl-8 !w-40"
                placeholder="Search…"
                value={clipQuery}
                onChange={(e) => setClipQuery(e.target.value)}
              />
            </div>
          }
        >
          {clipsError && <InlineAlert>{clipsError}</InlineAlert>}
          {copyMsg && (
            <div className="mb-2 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1.5 text-xs text-[var(--status-success)]">
              {copyMsg}
            </div>
          )}
          <div className="space-y-1.5">
            {filteredClips.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">
                No clipboard entries yet. Copy something and it'll appear here.
              </p>
            ) : (
              filteredClips.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-[var(--text-secondary)]" title={c.text}>{c.text}</div>
                    <div className="text-2xs text-[var(--text-tertiary)]">{fmtAge(c.ts)}</div>
                  </div>
                  <button
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    onClick={() => copyClip(c.text)}
                  >
                    <IconCopy size={13} />
                  </button>
                  <button
                    className={c.pinned ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}
                    onClick={() =>
                      call<ClipItem[]>("toggle_clipboard_pin", { id: c.id })
                        .then(() => refreshClips())
                        .catch((e) => toast(errorCopy(e), "err"))
                    }
                  >
                    <IconPin size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </Section>
      </div>

      {/* Macros */}
      <Section          title="Automation macros"
          subtitle="When an app opens, automatically switch to a saved look"
          actions={
            <button className="btn-primary text-xs" onClick={() => setMacroOpen(true)}>
              <IconPlus size={13} /> New macro
            </button>
          }
        >
        {macrosError && <InlineAlert>{macrosError}</InlineAlert>}
        {(macros ?? []).length === 0 ? (
          <div className="empty-state">
            No macros yet. Create one to auto-switch looks when you open an app.
          </div>
        ) : (
          <div className="space-y-2">
            {(macros ?? []).map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{m.name}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">
                    When <span className="text-[var(--text-secondary)]">{m.when_app}</span> starts → apply{" "}
                    {m.look_name}
                  </div>
                </div>
                <Toggle on={m.enabled} onChange={() => toggleMacro(m)} />
                <button
                  className="text-[var(--text-tertiary)] hover:text-[var(--status-danger)]"
                  onClick={() => removeMacro(m)}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Modal open={macroOpen} title="New automation macro" onClose={() => setMacroOpen(false)} onConfirm={createMacro} confirmLabel="Create macro">
        <div className="space-y-3">
          <div>
            <span className="label">Macro name</span>
            <input className="input" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="e.g. Gaming mode" />
          </div>
          <div>
            <span className="label">When app starts</span>
            <input className="input" value={mApp} onChange={(e) => setMApp(e.target.value)} placeholder="e.g. steam" />
          </div>
          <div>
            <span className="label">Apply look</span>
            <div className="segment">
              {["Midnight Rain", "Retro Wave", "Forest Calm"].map((l) => (
                <button
                  key={l}
                  onClick={() => setMLook(l)}
                  className={`segment-btn ${mLook === l ? "active" : ""}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
