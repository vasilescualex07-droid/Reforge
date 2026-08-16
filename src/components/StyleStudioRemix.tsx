import { useReducer, useState } from "react";
import { call, errorCopy } from "../lib/api";
import { toast } from "../components/ui";
import {
  remixReducer,
  remixToStyle,
  complement,
  analogous,
  triadic,
  shade,
} from "../lib/styleRemix";
import { ALL_WALLPAPERS } from "../styles";
import type { SceneConfig, ThemeState } from "../lib/types";

const ACCENT_SUGGESTIONS = [
  "#6D7CFF", "#FF2E88", "#FF7B54", "#34D399",
  "#2E7CF6", "#F59E0B", "#EC4899", "#8B5CF6",
];

/** F-C: Style Studio remix mode — independent wallpaper / accent / mode
 *  pickers with a live preview. Nothing applies until "Save as style", which
 *  calls the backend's apply_style (one undo entry). Empty state, save-failure
 *  copy, and keyboard focus follow the existing Section conventions. */
export function StyleStudioRemix({
  scenes,
  theme,
}: {
  scenes: SceneConfig[];
  theme: ThemeState | null;
}) {
  const [state, dispatch] = useReducer(remixReducer, {
    wallpaper: null,
    wallpaperType: "static",
    sceneId: null,
    accentHex: theme?.accent_hex ?? "#6D7CFF",
    mode: theme?.mode === "light" ? "light" : "dark",
  });
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const chosenName =
    state.wallpaperType === "scene"
      ? scenes.find((s) => s.id === state.sceneId)?.name ?? null
      : ALL_WALLPAPERS.find((w) => w.file === state.wallpaper)?.name ?? null;

  const saveStyle = async () => {
    const styleName = name.trim() || `Remix ${new Date().toLocaleDateString()}`;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await call<{ ok: boolean; name: string; notes?: string[] }>(
        "apply_style",
        { style: remixToStyle(state, styleName, scenes) },
      );
      setSavedName(res.name);
      toast(
        res.notes && res.notes.length > 0
          ? `${res.name} applied — ${res.notes.join(" · ")}`
          : `${res.name} applied`,
      );
    } catch (e) {
      const copy = errorCopy(e);
      setSaveError(copy);
      toast(copy, "err");
    } finally {
      setSaving(false);
    }
  };

  const wallpaperBtn = (active: boolean) =>
    `h-10 w-16 shrink-0 overflow-hidden rounded-md border text-left transition-colors ${
      active
        ? "border-[var(--border-accent)] ring-1 ring-[var(--accent-hex)]"
        : "border-[var(--border-default)] hover:border-[var(--border-accent)]"
    }`;

  return (
    <div className="mt-4 border-t border-[var(--border-default)] pt-4">
      <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
        Remix your own
      </div>
      <p className="mb-3 text-2xs text-[var(--text-tertiary)]">
        Pick a wallpaper, accent and mode independently — nothing applies until
        you save.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <div>
            <span className="label">Mode</span>
            <div className="segment">
              <button
                className={`segment-btn ${state.mode === "dark" ? "active" : ""}`}
                onClick={() => dispatch({ type: "setMode", mode: "dark" })}
              >
                Dark
              </button>
              <button
                className={`segment-btn ${state.mode === "light" ? "active" : ""}`}
                onClick={() => dispatch({ type: "setMode", mode: "light" })}
              >
                Light
              </button>
            </div>
          </div>

          <div>
            <span className="label">Wallpaper</span>
            <div className="max-h-48 overflow-y-auto pr-1">
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                <button
                  className={wallpaperBtn(state.wallpaperType === "static" && !state.wallpaper)}
                  title="No wallpaper — accent + mode only"
                  aria-pressed={state.wallpaperType === "static" && !state.wallpaper}
                  onClick={() => dispatch({ type: "clearWallpaper" })}
                  style={{ background: "#2b3245" }}
                >
                  <span className="flex h-full items-end px-1 pb-0.5 text-[9px] leading-tight text-white/70">— none</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_WALLPAPERS.map((w) => {
                  const active = state.wallpaper === w.file && state.wallpaperType !== "scene";
                  return (
                    <button
                      key={w.id}
                      title={`${w.name} (${w.type})`}
                      aria-pressed={active}
                      onClick={() =>
                        dispatch({ type: "setWallpaper", source: w.file, live: w.type === "live" })
                      }
                      className={wallpaperBtn(active)}
                      style={{
                        // content preview — renders the actual gradient wallpaper
                        background: `linear-gradient(135deg, ${shade(w.dominantColor, -30)}, ${w.dominantColor})`,
                      }}
                    >
                      <span className="flex h-full items-end px-1 pb-0.5 text-[9px] leading-tight text-white/80 drop-shadow">
                        {w.type === "live" ? "▶ " : ""}{w.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {scenes.map((s) => {
                  const active = state.wallpaperType === "scene" && state.sceneId === s.id;
                  return (
                    <button
                      key={s.id}
                      title={`Scene: ${s.name}`}
                      aria-pressed={active}
                      onClick={() => dispatch({ type: "setScene", sceneId: s.id })}
                      className={wallpaperBtn(active)}
                      style={{
                        // content preview — renders the actual scene gradient
                        background: `linear-gradient(135deg, ${s.colors[0] ?? "#334155"}, ${s.colors[1] ?? s.colors[0] ?? "#0f172a"})`,
                      }}
                    >
                      <span className="flex h-full items-end px-1 pb-0.5 text-[9px] leading-tight text-white/80 drop-shadow">
                        ✦ {s.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <span className="label">Accent color</span>
            <div className="mb-2 grid grid-cols-8 gap-2">
              {ACCENT_SUGGESTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => dispatch({ type: "setAccent", hex: c })}
                  className={`aspect-square rounded-lg transition hover:scale-105 ${
                    state.accentHex.toLowerCase() === c.toLowerCase()
                      ? "ring-2 ring-[var(--accent-hex)] ring-offset-2 ring-offset-white"
                      : ""
                  }`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-2xs text-[var(--text-tertiary)]">Custom:</label>
              <input
                type="color"
                value={state.accentHex}
                onChange={(e) => dispatch({ type: "setAccent", hex: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
              />
              <span className="font-mono text-2xs text-[var(--text-tertiary)]">{state.accentHex}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {[
                ["Complementary", complement(state.accentHex)],
                ["Analogous −", analogous(state.accentHex, -30)],
                ["Analogous +", analogous(state.accentHex, 30)],
                ["Triadic 1", triadic(state.accentHex, 120)],
                ["Triadic 2", triadic(state.accentHex, 240)],
              ].map(([label, c], i) => (
                <button
                  key={i}
                  title={label}
                  aria-label={label}
                  onClick={() => dispatch({ type: "setAccent", hex: c })}
                  className="h-5 w-5 rounded-sm transition hover:scale-110"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <span className="label">Live preview</span>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-strong)]">
            {/* content preview — renders the actual gradient wallpaper */}
            <div
              className="absolute inset-0"
              style={{
                // content preview — renders the actual gradient wallpaper
                background: `linear-gradient(135deg, ${shade(state.accentHex, -60)} 0%, ${shade(state.accentHex, 10)} 100%)`,
              }}
            />
            <div className="absolute left-[8%] top-[14%] h-[38%] w-[42%] rounded-lg border border-white/15 bg-black/25 backdrop-blur-[2px]">
              <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-white/25" />
                <span className="ml-3 h-2 w-16 rounded bg-white/20" />
              </div>
              <div className="space-y-1.5 p-3">
                <div className="h-2 w-3/4 rounded bg-white/15" />
                <div className="h-2 w-1/2 rounded bg-white/10" />
              </div>
            </div>
            <div
              className="absolute bottom-0 left-0 right-0 flex h-9 items-center gap-2 border-t border-white/10 px-3"
              style={{
                background:
                  state.mode === "light" ? "rgba(245,246,250,0.78)" : "rgba(10,12,20,0.6)",
              }}
            >
              <span className="h-3.5 w-3.5 rounded-md" style={{ background: state.accentHex }} />
              <span className="text-2xs text-white/70">
                {state.mode === "light" ? "Light" : "Dark"} mode
              </span>
              <span className="ml-auto truncate text-2xs text-white/60" title={chosenName ?? "No wallpaper"}>
                {chosenName ?? "No wallpaper"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input !w-56"
          placeholder={`Name (default: Remix ${new Date().toLocaleDateString()})`}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          aria-label="Style name"
        />
        <button className="btn-primary shrink-0" onClick={saveStyle} disabled={saving}>
          {saving ? "Saving…" : "Save as style"}
        </button>
        {saveError ? (
          <span className="text-2xs text-[var(--status-danger)]">{saveError}</span>
        ) : savedName ? (
          <span className="text-2xs text-[var(--status-success)]">
            Saved — {savedName} is applied. Undo it from History.
          </span>
        ) : (
          <span className="text-2xs text-[var(--text-tertiary)]">
            No styles yet — remix one and save it.
          </span>
        )}
      </div>
    </div>
  );
}
