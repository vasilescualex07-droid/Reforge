import { useState } from "react";
import { errorCopy, call } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import type { DisplayMonitorInfo, DisplayProfile } from "../lib/types";
import { InlineAlert, Section, toast } from "../components/ui";
import { IconRefresh, IconMonitor, IconPlus, IconTrash } from "../components/icons";

export default function Displays() {
  // S2.1/S2.3 — shared loaders: a real error surface per section (never a
  // dead blank), one toast per command per session, and a refresh() handle.
  const { data: monitors, error: monitorError, refresh: refreshMonitors } = useLoad<DisplayMonitorInfo[]>("get_display_info");
  const { data: profiles, error: profilesError, refresh: refreshProfiles } = useLoad<DisplayProfile[]>("list_display_profiles");
  const [name, setName] = useState("");

  const refresh = () => {
    refreshMonitors();
    refreshProfiles();
  };

  const saveProfile = () => {
    if (!name.trim()) return toast("Give the profile a name", "err");
    call("save_display_profile", { name })
      .then(() => {
        setName("");
        toast(`Saved display profile "${name}"`);
        refresh();
      })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const applyProfile = (p: DisplayProfile) => {
    call("apply_display_profile", { id: p.id })
      .then((m) => toast(m as string))
      .catch((e) => toast(errorCopy(e), "err"));
  };

  const deleteProfile = (p: DisplayProfile) => {
    call("delete_display_profile", { id: p.id }).then(refresh).catch((e) => toast(errorCopy(e), "err"));
  };

  return (
    <div className="space-y-5">
      <div className="page-head flex items-end justify-between">
        <div>
          <h1 className="page-title">Displays</h1>
          <p className="page-subtitle">
            Monitors, per-screen wallpapers, display profiles
          </p>
        </div>
        <button className="btn-primary" onClick={refresh}>
          <IconRefresh size={14} /> Refresh
        </button>
      </div>

      {/* Spatial Monitor Layout */}
      <Section title="Monitors" subtitle="Detected displays and their current modes">
        {monitorError ? (
          <InlineAlert>{monitorError}</InlineAlert>
        ) : monitors && monitors.length > 0 ? (
          <div className="relative">
            {/* Visual layout representation */}
            <div className="mb-6 flex items-end justify-center gap-4 p-6">
              {monitors.map((m) => (
                <div
                  key={m.id}
                  className={`relative flex flex-col items-center rounded-xl border-2 transition-colors ${
                    m.primary
                      ? "border-[var(--border-accent)] bg-[var(--surface-selected)]"
                      : "border-[var(--border-default)] bg-[var(--surface-overlay)]"
                  }`}
                  style={{
                    width: m.primary ? "280px" : "200px",
                    height: m.primary ? "160px" : "115px",
                  }}
                >
                  <div className="flex h-full flex-col items-center justify-center gap-1">
                    <IconMonitor
                      size={24}
                      className={m.primary ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}
                    />
                    <div className="text-xs font-medium text-[var(--text-primary)]">{m.resolution}</div>
                    <div className="text-2xs text-[var(--text-tertiary)]">{m.refresh} Hz</div>
                  </div>
                  {m.primary && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 badge badge-accent">
                      PRIMARY
                    </div>
                  )}
                  <div className="w-full border-t border-[var(--border-subtle)] px-3 py-1.5 text-center text-2xs text-[var(--text-tertiary)]">
                    {m.id}
                  </div>
                </div>
              ))}
            </div>

            {/* Monitor details */}
            <div className="space-y-2">
              {monitors.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-overlay)]">
                    <IconMonitor
                      size={16}
                      className={m.primary ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {m.name}{" "}
                      {m.primary && <span className="badge badge-accent ml-1">PRIMARY</span>}
                    </div>
                    <div className="text-2xs text-[var(--text-tertiary)]">
                      {m.resolution} @ {m.refresh} Hz
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">No displays detected.</div>
        )}
      </Section>

      {/* Display Profiles */}
      <Section
        title="Display profiles"
        subtitle="Save and restore multi-monitor wallpaper arrangements"
        actions={
          <div className="flex gap-2">
            <input
              className="input !w-48"
              placeholder="Profile name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn-primary text-xs" onClick={saveProfile} disabled={!name.trim()}>
              <IconPlus size={13} /> Save
            </button>
          </div>
        }
      >
        {profilesError ? (
          <InlineAlert>{profilesError}</InlineAlert>
        ) : !profiles || profiles.length === 0 ? (
          <div className="empty-state">
            No profiles saved yet. Set up your monitors exactly how you want them, then save a profile.
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{p.name}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">
                    {p.monitors.length} monitor(s) · saved {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button className="btn-ghost btn-sm" onClick={() => applyProfile(p)}>
                  Apply
                </button>
                <button
                  className="btn-ghost btn-sm text-[var(--text-tertiary)] hover:!text-[var(--status-danger)]"
                  onClick={() => deleteProfile(p)}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
