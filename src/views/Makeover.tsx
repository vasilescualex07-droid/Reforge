import { useEffect, useMemo, useRef, useState } from "react";
import { errorCopy, call, callWithTimeout, fmt, onEvent, swallow } from "../lib/api";
import { applyStyleDef } from "../lib/styleApply";
import { useLoad, useLazyLoad, useVisibleOnce } from "../lib/useLoad";
import { announceThemeChanged } from "../lib/theme-dom";

// Heavy operations (video import) get a hard deadline so a hung command can
// never leave the UI stuck on "Applying…" forever. Generous — a big user
// video can legitimately transcode for a minute+.
const IMPORT_TIMEOUT_MS = 180_000;
import type {
  CapabilityMatrix, CursorScheme, CursorState, EngineState, FontEntry,
  FontSubstitution, LockScreenState, Pack, PendingShellState, SceneConfig,
  ScreensaverConfig, ScreensaverRegistry, SoundEventInfo,
  SoundSchemeInfo, TaskbarState, ThemeState, TranscodeStatus, UndoEntry,
  VideoWallpaper, WallpaperHistoryEntry, WallpaperSlideshowConfig,
  WallpaperState, WidgetConfig, WidgetsSettings,
} from "../lib/types";
import { InlineAlert, Modal, ScenePreview, Section, StatusDot, Toggle, toast } from "../components/ui";
import { StyleStudioRemix } from "../components/StyleStudioRemix";
import { complement, analogous, triadic, hexToHsl, hslToHex } from "../lib/styleRemix";
import { decodeStyleCode, encodeStyleCode, shareCodeError } from "../lib/shareCodes";
import { getStyleAnalytics, recordStyleApplied, type StyleAnalytics } from "../lib/styleAnalytics";
import {
  IconPower, IconPlus, IconTrash, IconPause, IconPlay,
  IconImage, IconFilm, IconStar, IconSearch, IconChevronDown,
} from "../components/icons";
import type { StyleDef, QuizAnswers } from "../styles/types";
import type { WallpaperEntry } from "../styles";
import {
  ALL_STYLES,
  ALL_WALLPAPERS,
  CATEGORIES,
  STYLE_COUNT,
  STYLE_COLLECTIONS,
  WALLPAPER_COUNT,
  QUIZ,
  EMPTY_ANSWERS,
  mergeAnswers,
  rankStyles,
  scoreStyle,
  buildMyStyle,
  getStyle,
  naturalVariantId,
  styleComponents,
  sceneConfigForStyle,
} from "../styles";

const ACCENT_SUGGESTIONS = [
  "#6D7CFF", "#FF2E88", "#FF7B54", "#34D399",
  "#2E7CF6", "#F59E0B", "#EC4899", "#8B5CF6",
];

const STYLE_CATEGORIES = ["All", ...new Set(ALL_STYLES.map((s) => s.category))];

/** Copy to the clipboard with a legacy execCommand fallback for older webviews. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function Makeover() {
  // ---- Theme ----
  // S2.2 — every state-critical load goes through useLoad: one toast per
  // command per session on first failure, plus a per-section InlineAlert.
  const [theme, setTheme] = useState<ThemeState | null>(null);
  const { data: wallpapers, error: wallpapersError, refresh: refreshWallpapers } = useLoad<WallpaperState>("get_wallpapers");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [activePack, setActivePack] = useState<Pack | null>(null);
  const [wpPath, setWpPath] = useState("");
  const [applying, setApplying] = useState<string | null>(null);

  // ---- Cursor (S7.2: loads when its section first scrolls into view) ----
  const { data: cursorSchemes, error: cursorSchemesError, refresh: refreshCursorSchemes, load: loadCursorSchemes } = useLazyLoad<CursorScheme[]>("list_cursor_schemes");
  const { data: cursorState, error: cursorStateError, refresh: refreshCursorState, load: loadCursorState } = useLazyLoad<CursorState>("get_cursor_state");
  const cursorRef = useVisibleOnce(() => { loadCursorSchemes(); loadCursorState(); });

  // ---- Style Quiz v3 ----
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizStep, setQuizStep] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>(EMPTY_ANSWERS);
  const [quizDone, setQuizDone] = useState(false);

  // ---- Style Studio ----
  const [detailStyle, setDetailStyle] = useState<StyleDef | null>(null);
  const [animOn, setAnimOn] = useState(false);
  useEffect(() => { setAnimOn(false); }, [detailStyle?.id]);
  // C3 — animated gallery previews: only the hovered card mounts a scene
  // canvas, so nothing animates (or decodes) until the pointer is on it.
  const [hoverStyle, setHoverStyle] = useState<string | null>(null);
  const { data: appliedStyleId, error: appliedStyleError, refresh: refreshAppliedStyle } = useLoad<string>("get_applied_style");
  const [applyingStyle, setApplyingStyle] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [styleQuery, setStyleQuery] = useState("");
  const [styleCat, setStyleCat] = useState("All");
  const [styleTier, setStyleTier] = useState<"all" | StyleDef["tier"]>("all");
  const [styleAxis, setStyleAxis] = useState<"all" | NonNullable<StyleDef["axis"]>>("all");
  const [styleCollection, setStyleCollection] = useState("All");
  // S6.5 — share codes: import row + detail-modal copy.
  const [importOpen, setImportOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  // S6.7 — local apply analytics (most-used strip + insight).
  const [analytics, setAnalytics] = useState<StyleAnalytics>(() => getStyleAnalytics());
  // Favorites: localStorage is only the fast first-paint mirror; the backend
  // file (data_dir/favorites.json) is the durable source of truth (A2.1).
  // The load has a real error state (the mirror still works if it fails) and
  // the backend-sync write is a dev-loud shim (the mirror stays consistent).
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("reforge.style-favs") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  // Favorites load keeps the local mirror as its fallback; failure is surfaced
  // via an InlineAlert next to the favorites button instead of a silent blank.
  const refreshFavorites = () => {
    call<string[]>("get_favorites")
      .then((ids) => { setFavorites(ids); setFavoritesError(null); })
      .catch((e) => setFavoritesError(errorCopy(e)));
  };

  // ---- Engine ----
  const { data: engine, error: engineError, refresh: refreshEngine, load: loadEngine } = useLazyLoad<EngineState>("get_wallpaper_engine_state");
  const engineRef = useVisibleOnce(() => { loadEngine(); });
  const { data: scenes, error: scenesError, refresh: refreshScenes } = useLoad<SceneConfig[]>("list_wallpaper_scenes");
  const [moodFilter, setMoodFilter] = useState("all");
  // S7.6 — scene tiles play only on hover: at most one ScenePreview canvas
  // animates at a time, zero on load (same budget as the style grid).
  const [hoverScene, setHoverScene] = useState<string | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);

  // ---- Widgets ----
  const { data: widgets, error: widgetsError, refresh: refreshWidgets, load: loadWidgets } = useLazyLoad<WidgetConfig[]>("list_widgets");
  const { data: widgetsSettings, refresh: refreshWidgetsSettings, load: loadWidgetsSettings } = useLazyLoad<WidgetsSettings>("get_widgets_settings");
  const widgetsRef = useVisibleOnce(() => { loadWidgets(); loadWidgetsSettings(); });
  // S9.6 — the board preview needs the engine scene + widget list; loading
  // them again here is idempotent (same commands the sections above fire).
  const boardRef = useVisibleOnce(() => { loadEngine(); loadWidgets(); });

  // ---- Wallpaper Studio ----
  const [studioOpen, setStudioOpen] = useState(false);
  const [studio, setStudio] = useState<SceneConfig>({
    id: "studio-custom", name: "My Scene", kind: "particles",
    mood: "custom", speed: 1.0, density: 1.0,
    colors: ["#818cf8", "#38bdf8", "#f472b6"],
  });

  // ---- Video wallpaper ----
  const { data: videoWallpapers, error: videoError, refresh: refreshVideoWallpapers, load: loadVideoWallpapers } = useLazyLoad<VideoWallpaper[]>("list_video_wallpapers");
  const { data: transcode, error: transcodeError, refresh: refreshTranscode, load: loadTranscode } = useLazyLoad<TranscodeStatus>("media_get_transcode_status");
  const videoRef = useVisibleOnce(() => { loadVideoWallpapers(); loadTranscode(); });
  const [videoPath, setVideoPath] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  // E1 — live transcode status from the backend (`transcode-progress` events).
  const [transcodeNote, setTranscodeNote] = useState<string | null>(null);

  // ---- Taskbar ----
  const { data: taskbar, error: taskbarError, refresh: refreshTaskbarState, load: loadTaskbar } = useLazyLoad<TaskbarState>("shell_get_taskbar_state");
  const { data: pendingShell, error: pendingError, refresh: refreshPendingShell, load: loadPendingShell } = useLazyLoad<PendingShellState>("shell_get_pending_state");
  const taskbarRef = useVisibleOnce(() => { loadTaskbar(); loadPendingShell(); });

  // ---- Sounds ----
  const { data: schemes, error: schemesError, refresh: refreshSchemes, load: loadSchemes } = useLazyLoad<SoundSchemeInfo[]>("list_sound_schemes");
  const { data: soundEvents, error: soundEventsError, refresh: refreshSoundEvents, load: loadSoundEvents } = useLazyLoad<SoundEventInfo[]>("list_sound_events");
  const soundsRef = useVisibleOnce(() => { loadSchemes(); loadSoundEvents(); });
  const [schemeName, setSchemeName] = useState("");

  // ---- Fonts ----
  const { data: fontSubs, error: fontSubsError, refresh: refreshFontSubs, load: loadFontSubs } = useLazyLoad<FontSubstitution[]>("list_font_substitutions");
  const { data: installedFonts, error: installedFontsError, refresh: refreshInstalledFonts, load: loadInstalledFonts } = useLazyLoad<FontEntry[]>("list_installed_fonts");
  const fontsRef = useVisibleOnce(() => { loadFontSubs(); loadInstalledFonts(); });
  const [fontOriginal, setFontOriginal] = useState("Segoe UI");
  const [fontSubstitute, setFontSubstitute] = useState("");
  const [fontInstallPath, setFontInstallPath] = useState("");

  // ---- Lock Screen ----
  const { data: lockScreen, error: lockScreenError, refresh: refreshLockScreenState, load: loadLockScreen } = useLazyLoad<LockScreenState>("get_lock_screen_state");
  const lockRef = useVisibleOnce(() => { loadLockScreen(); });
  const [lsImagePath, setLsImagePath] = useState("");
  const [lsFolder, setLsFolder] = useState("");
  const [lsInterval, setLsInterval] = useState(30);

  // ---- Static wallpaper: slideshow + history + per-monitor ----
  const { data: slideshow, error: slideshowError, refresh: refreshSlideshowCfg } = useLoad<WallpaperSlideshowConfig>("get_wallpaper_slideshow");
  const { data: wpHistory, error: wpHistoryError, refresh: refreshWpHistory } = useLoad<WallpaperHistoryEntry[]>("get_wallpaper_history");
  const [slideshowFolder, setSlideshowFolder] = useState("");
  const [slideshowInterval, setSlideshowInterval] = useState(30);
  const [monitorTarget, setMonitorTarget] = useState("");
  // S11.5 — smart slideshow: favorites (3× weight), day/night filter, skip-now.
  const [favInput, setFavInput] = useState("");

  // ---- Capability matrix ----
  const { data: caps, error: capsError, refresh: refreshCaps } = useLoad<CapabilityMatrix>("get_capability_matrix");

  const refreshSlideshow = () => {
    refreshSlideshowCfg();
    refreshWpHistory();
  };

  // S2.2 — keep the editable slideshow inputs in sync with the loaded config.
  useEffect(() => {
    if (slideshow) {
      setSlideshowFolder(slideshow.folder);
      setSlideshowInterval(slideshow.interval_minutes);
    }
  }, [slideshow]);

  const saveSlideshow = (patch: Partial<WallpaperSlideshowConfig>) => {
    const base: WallpaperSlideshowConfig = slideshow ?? {
      enabled: false, folder: slideshowFolder, interval_minutes: slideshowInterval,
      shuffle: false, next_rotation_ts: null, last_applied: null,
      favorites: [], day_night_filter: false,
    };
    const next: WallpaperSlideshowConfig = { ...base, ...patch, folder: slideshowFolder, interval_minutes: slideshowInterval };
    call<WallpaperSlideshowConfig>("set_wallpaper_slideshow", { cfg: next })
      .then(() => { refreshSlideshowCfg(); toast(next.enabled ? `Rotation on — every ${next.interval_minutes} min` : "Rotation off"); })
      .catch((e) => toast(errorCopy(e), "err"));
  };

  // S11.5 — favorites are weighted 3× in the rotation; skip jumps straight
  // to the next pick (no waiting for the interval).
  const addFavorite = () => {
    const p = favInput.trim();
    if (!p) return;
    const cur = slideshow?.favorites ?? [];
    if (!cur.includes(p)) saveSlideshow({ favorites: [...cur, p] });
    setFavInput("");
  };

  const removeFavorite = (p: string) => {
    saveSlideshow({ favorites: (slideshow?.favorites ?? []).filter((f) => f !== p) });
  };

  const skipNow = async () => {
    try {
      const msg = await call<string>("skip_slideshow");
      toast(msg);
      refreshSlideshow();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const setWallpaperTarget = async () => {
    if (!wpPath.trim()) return;
    try {
      const isLive = /\.(mp4|webm|gif)$/i.test(wpPath.trim());
      if (monitorTarget && wallpapers?.monitors.some((m) => m.id === monitorTarget)) {
        await call<WallpaperState>("set_monitor_wallpaper", { monitor_id: monitorTarget, path: wpPath });
        toast("Wallpaper set for that monitor only");
      } else if (isLive) {
        const eng = await callWithTimeout<EngineState>("set_video_wallpaper", { source: wpPath }, IMPORT_TIMEOUT_MS);
        toast(`Now playing: ${eng.media?.name ?? "video"}`);
      } else {
        await call<WallpaperState>("set_wallpaper", { path: wpPath });
        toast("Wallpaper set");
      }
      refresh();
      refreshSlideshow();
      refreshVideo();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const refreshTaskbar = () => {
    refreshTaskbarState();
    refreshPendingShell();
  };

  const refreshVideo = () => {
    refreshVideoWallpapers();
    refreshTranscode();
  };

  const refreshSounds = () => {
    refreshSchemes();
    refreshSoundEvents();
  };

  const refreshFonts = () => {
    refreshFontSubs();
    refreshInstalledFonts();
  };

  const refreshLockScreen = () => {
    refreshLockScreenState();
  };

  const refresh = () => {
    // Core: everything the first paint and primary sections need. Theme + packs
    // keep their existing toast (not silent), everything else refreshes its
    // useLoad handle (which re-fetches and clears any stale error).
    call<ThemeState>("get_theme_state").then(setTheme).catch(() => toast("Failed to load theme", "err"));
    call<Pack[]>("list_packs").then(setPacks).catch(() => toast("Failed to load packs", "err"));
    refreshWallpapers();
    refreshEngine();
    refreshScenes();
    refreshWidgets();
    refreshVideo();
    refreshTaskbar();
    refreshSlideshow();
    refreshCaps();
    refreshAppliedStyle();
    refreshFavorites();
    // Peripheral: cursor, sounds, fonts, lock screen — fetched after first
    // paint so the view mounts fast (C2.1).
    window.setTimeout(() => {
      refreshCursorSchemes();
      refreshCursorState();
      refreshSounds();
      refreshFonts();
      refreshLockScreen();
    }, 0);
  };

  // Mount: theme + packs are plain calls (not useLoad) — fetch them once
  // here. The eager useLoad sections (wallpapers, scenes, slideshow, history,
  // applied style, favorites, caps, undo log) self-fetch on mount, and the
  // lazy sections fetch when their section first scrolls into view (S7.2) —
  // so a full `refresh()` here would double-fetch everything eager.
  useEffect(() => {
    call<ThemeState>("get_theme_state").then(setTheme).catch(() => toast("Failed to load theme", "err"));
    call<Pack[]>("list_packs").then(setPacks).catch(() => toast("Failed to load packs", "err"));
    // Favorites are a plain call (the mirror seeds first paint) — fetch the
    // durable backend copy once on mount.
    refreshFavorites();
  }, []);

  // ---- Handlers ----
  // E1 — subscribe to the ffmpeg progress stream so the import button shows a
  // live "Normalizing video… Ns" line instead of an opaque spinner.
  useEffect(
    () =>
      onEvent<{ phase: string; seconds?: number }>("transcode-progress", (p) => {
        if (p.phase === "transcoding")
          setTranscodeNote(`Normalizing video… ${Math.max(1, Math.floor(p.seconds ?? 0))}s`);
        else if (p.phase === "done") setTranscodeNote("Normalized — applying…");
      }),
    [],
  );

  const setVideoWallpaper = async () => {
    if (!videoPath.trim()) return;
    setVideoBusy(true);
    setTranscodeNote(null);
    try {
      await callWithTimeout<EngineState>("set_video_wallpaper", { source: videoPath }, IMPORT_TIMEOUT_MS);
      refreshEngine(); refreshVideo(); toast("Video wallpaper set");
    } catch (err) { toast(errorCopy(err), "err"); } finally { setVideoBusy(false); setTranscodeNote(null); }
  };

  const stopVideoWallpaper = async () => {
    setVideoBusy(true);
    try {
      await call<EngineState>("stop_video_wallpaper", {});
      refreshEngine(); toast("Video wallpaper stopped");
    } catch (err) { toast(errorCopy(err), "err"); } finally { setVideoBusy(false); }
  };

  const setTaskbarSize = (size: string) =>
    call<TaskbarState>("shell_set_taskbar_size", { size }).then(() => { toast(`Taskbar size → ${size}`); refreshTaskbarState(); }).catch((e) => toast(errorCopy(e), "err"));
  const setTaskbarAlign = (align: string) =>
    call<TaskbarState>("shell_set_taskbar_alignment", { align }).then(() => { toast(`Taskbar alignment → ${align}`); refreshTaskbarState(); }).catch((e) => toast(errorCopy(e), "err"));
  const setTaskbarAutohide = (on: boolean) =>
    call<TaskbarState>("shell_set_taskbar_autohide", { on }).then(() => { toast(on ? "Taskbar auto-hides" : "Taskbar always visible"); refreshTaskbarState(); }).catch((e) => toast(errorCopy(e), "err"));
  const setTaskbarColorMatch = (on: boolean) =>
    call<TaskbarState>("shell_set_taskbar_color_match", { on }).then(() => { toast(on ? "Taskbar matches accent" : "Taskbar color match off"); refreshTaskbarState(); }).catch((e) => toast(errorCopy(e), "err"));
  const setTaskbarPosition = (side: string) =>
    call<string>("shell_set_taskbar_position", { side }).then((m) => { toast(m); refreshTaskbar(); }).catch((e) => toast(errorCopy(e), "err"));
  const applyPendingRestart = () =>
    call<string>("shell_apply_pending_restart").then((m) => { toast(m); refreshTaskbar(); }).catch((e) => toast(errorCopy(e), "err"));
  const revertPending = () =>
    call<string>("shell_revert_pending").then((m) => { toast(m); refreshTaskbar(); }).catch((e) => toast(errorCopy(e), "err"));

  const applyScheme = (guid: string) =>
    call<string>("apply_sound_scheme", { guid }).then((m) => { toast(m); refreshSounds(); }).catch((e) => toast(errorCopy(e), "err"));
  const saveScheme = () => {
    if (!schemeName.trim()) return;
    call<string>("save_current_scheme", { name: schemeName.trim() }).then((m) => { toast(m); setSchemeName(""); refreshSounds(); }).catch((e) => toast(errorCopy(e), "err"));
  };
  const setEventSound = (evt: string, path: string) =>
    call("set_sound_event", { event: evt, path }).then(() => refreshSounds()).catch((e) => toast(errorCopy(e), "err"));
  const previewSound = (path: string) =>
    call("preview_sound", { path }).then((m) => toast(m as string)).catch((e) => toast(errorCopy(e), "err"));

  const applyFontSub = () => {
    if (!fontOriginal.trim()) return;
    call<FontSubstitution[]>("set_font_substitution", { original: fontOriginal, substitute: fontSubstitute })
      .then(() => { toast("Font substitution set"); refreshFontSubs(); })
      .catch((e) => toast(errorCopy(e), "err"));
  };
  const installFont = () => {
    if (!fontInstallPath.trim()) return;
    call<FontEntry[]>("install_user_font", { path: fontInstallPath })
      .then(() => { toast("Font installed"); setFontInstallPath(""); refreshInstalledFonts(); })
      .catch((e) => toast(errorCopy(e), "err"));
  };
  const removeFont = (name: string) => {
    call<FontEntry[]>("remove_user_font", { name }).then(() => { toast(`Removed: ${name}`); refreshInstalledFonts(); }).catch((e) => toast(errorCopy(e), "err"));
  };

  const setLsImage = () => {
    if (!lsImagePath.trim()) return;
    call<LockScreenState>("set_lock_screen_image", { source: lsImagePath }).then(() => { toast("Lock screen image set"); refreshLockScreenState(); }).catch((e) => toast(errorCopy(e), "err"));
  };
  const setLsSlideshow = () => {
    if (!lsFolder.trim()) return;
    call<LockScreenState>("set_lock_screen_slideshow", { folder: lsFolder, interval_minutes: lsInterval, shuffle: true }).then(() => { toast("Lock screen slideshow set"); refreshLockScreenState(); }).catch((e) => toast(errorCopy(e), "err"));
  };
  const setLsSpotlight = () =>
    call<LockScreenState>("set_lock_screen_spotlight", {}).then(() => { toast("Spotlight enabled"); refreshLockScreenState(); }).catch((e) => toast(errorCopy(e), "err"));
  const setLsHideApps = (hide: boolean) =>
    call<LockScreenState>("set_lock_screen_hide_apps", { hide }).then(() => { toast(`Detailed status ${hide ? "hidden" : "shown"}`); refreshLockScreenState(); }).catch((e) => toast(errorCopy(e), "err"));

  const applyScene = async (scene: SceneConfig) => {
    setEngineBusy(true);
    try { await call<EngineState>("set_animated_wallpaper", { scene }); refreshEngine(); toast(`Animated wallpaper: ${scene.name}`); }
    catch (err) { toast(errorCopy(err), "err"); } finally { setEngineBusy(false); }
  };

  const stopScene = async () => {
    setEngineBusy(true);
    try { await call<EngineState>("stop_animated_wallpaper", {}); refreshEngine(); toast("Animated wallpaper stopped"); }
    catch (err) { toast(errorCopy(err), "err"); } finally { setEngineBusy(false); }
  };

  const freezeScene = async (frozen: boolean) => {
    try { await call<EngineState>("freeze_wallpaper", { frozen }); refreshEngine(); toast(frozen ? "Frozen" : "Resumed"); }
    catch (err) { toast(errorCopy(err), "err"); }
  };

  // ---- Screensaver (E4.6) ----
  const { data: screensaverCfg, error: screensaverCfgError, refresh: refreshScreensaverCfg, load: loadScreensaverCfg } = useLazyLoad<ScreensaverConfig>("get_screensaver_config");
  const { data: screensaverReg, refresh: refreshScreensaverReg, load: loadScreensaverReg } = useLazyLoad<ScreensaverRegistry>("get_screensaver_registry");
  const screensaverRef = useVisibleOnce(() => { loadScreensaverCfg(); loadScreensaverReg(); });
  const [screensaverBusy, setScreensaverBusy] = useState(false);
  const [screensaverSceneId, setScreensaverSceneId] = useState<string>("");
  // Local mirror — successive saves merge onto THIS, not the (async) hook data,
  // so a fast toggle→timeout→scene sequence can't clobber earlier edits.
  const [ssCfg, setSsCfg] = useState<ScreensaverConfig | null>(null);
  // Adopt the loaded config only if the user hasn't edited yet — a stale load
  // resolving after a save must never overwrite the user's choice.
  useEffect(() => { setSsCfg((prev) => prev ?? screensaverCfg ?? null); }, [screensaverCfg]);
  const shownSsCfg = ssCfg ?? screensaverCfg;

  const saveScreensaver = async (next: Partial<ScreensaverConfig>) => {
    const base = shownSsCfg ?? { enabled: false, timeout_secs: 300, scene: null };
    try {
      const saved = await call<ScreensaverConfig>("set_screensaver_config", { config: { ...base, ...next } });
      setSsCfg(saved); refreshScreensaverCfg(); refreshScreensaverReg();
      toast(saved.enabled ? `Screensaver armed — activates after ${saved.timeout_secs}s idle` : "Screensaver disabled");
    } catch (err) { toast(errorCopy(err), "err"); }
  };

  const previewScreensaver = async () => {
    setScreensaverBusy(true);
    try { const msg = await call<string>("preview_screensaver"); toast(msg); }
    catch (err) { toast(errorCopy(err), "err"); } finally { setScreensaverBusy(false); }
  };

  const createWidget = async (kind: string) => {
    try { await call<WidgetConfig>("create_widget", { kind }); toast(`${kind} widget added`); refreshWidgets(); }
    catch (err) { toast(errorCopy(err), "err"); }
  };

  const resetWidgetLayout = async () => {
    try {
      const msg = await call<string>("reset_widget_layout");
      toast(msg);
      refreshWidgets();
    } catch (err) {
      toast(errorCopy(err), "err");
    }
  };

  const toggleWidget = async (w: WidgetConfig, visible: boolean) => {
    try { await call("set_widget_visible", { id: w.id, visible }); refreshWidgets(); }
    catch (err) { toast(errorCopy(err), "err"); }
  };

  const saveWidgetsSettings = async (next: Partial<WidgetsSettings>) => {
    try {
      const saved = await call<WidgetsSettings>("set_widgets_settings", {
        settings: { ...(widgetsSettings ?? { autohide_fullscreen: true }), ...next },
      });
      refreshWidgetsSettings();
      toast(saved.autohide_fullscreen ? "Widgets auto-hide during fullscreen apps" : "Widgets stay visible over fullscreen apps");
    } catch (err) { toast(errorCopy(err), "err"); }
  };

  const removeWidget = async (w: WidgetConfig) => {
    try { await call("remove_widget", { id: w.id }); refreshWidgets(); }
    catch (err) { toast(errorCopy(err), "err"); }
  };

  const applyStudio = async () => { await applyScene(studio); setStudioOpen(false); };

  // A6.2 — scene editor v2: save the studio scene as a persistent custom scene.
  // Each save stamps a fresh id so saving twice creates two scenes (undoable).
  const saveStudioScene = async () => {
    const saved: SceneConfig = { ...studio, id: `custom-${Date.now().toString(36)}` };
    try {
      await call<SceneConfig[]>("save_custom_scene", { scene: saved });
      toast(`Custom scene “${saved.name}” saved — undoable from History`);
      setStudio({ ...studio, name: "My Scene" });
      refreshScenes();
    } catch (err) {
      toast(errorCopy(err), "err");
    }
  };

  const deleteCustomScene = async (s: SceneConfig) => {
    try {
      await call<SceneConfig[]>("delete_custom_scene", { id: s.id });
      toast(`Custom scene “${s.name}” deleted`);
      refreshScenes();
    } catch (err) {
      toast(errorCopy(err), "err");
    }
  };

  const setAccent = async (hex: string) => {
    try { const t = await call<ThemeState>("set_accent_color", { hex }); setTheme(t); announceThemeChanged(t.accent_hex, t.mode); toast(`Accent → ${hex}`); }
    catch (e) { toast(errorCopy(e), "err"); }
  };

  const setMode = async (mode: "dark" | "light") => {
    try { const t = await call<ThemeState>("set_theme_mode", { mode }); setTheme(t); announceThemeChanged(t.accent_hex, t.mode); toast(`Mode → ${mode}`); }
    catch (e) { toast(errorCopy(e), "err"); }
  };

  const setTransparency = async (on: boolean) => {
    try { const t = await call<ThemeState>("set_transparency", { on }); setTheme(t); }
    catch (e) { toast(errorCopy(e), "err"); }
  };

  const applyPack = async (p: Pack) => {
    setApplying(p.id);
    try { await call<Pack>("apply_pack", { id: p.id }); setActivePack(p); refresh(); toast(`Applied "${p.name}"`); }
    catch (e) { toast(errorCopy(e), "err"); } finally { setApplying(null); }
  };

  const applyCursor = async (id: string) => {
    try { await call<CursorState>("apply_cursor_scheme", { id }); refreshCursorState(); toast("Cursor scheme applied"); }
    catch (e) { toast(errorCopy(e), "err"); }
  };

  const pickQuiz = (optIdx: number) => {
    const next = mergeAnswers(answers, QUIZ[quizStep], optIdx);
    setAnswers(next);
    if (quizStep + 1 < QUIZ.length) setQuizStep(quizStep + 1);
    else setQuizDone(true);
  };

  const resetQuiz = () => { setQuizStep(0); setAnswers(EMPTY_ANSWERS); setQuizDone(false); };
  const quizResults = quizDone ? rankStyles(ALL_STYLES, answers).slice(0, 3) : [];
  const myStyle = quizDone ? buildMyStyle(answers) : null;

  const favBusy = useRef<string | null>(null);
  const toggleFav = (id: string) => {
    // Ignore re-entry until the backend answers — a double-click must not
    // issue two identical toggles from the same stale state.
    if (favBusy.current === id) return;
    favBusy.current = id;
    const nowFav = !favorites.includes(id);
    setFavorites((f) => {
      const next = nowFav ? [...f, id] : f.filter((x) => x !== id);
      try { localStorage.setItem("reforge.style-favs", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    // Durable copy — overwrites from the backend on success (preview: same result).
    call<string[]>("set_favorite", { id, fav: nowFav })
      .then((ids) => setFavorites(ids))
      .catch((e) => swallow("set_favorite mirror", e)) /* mirror stays consistent */
      .finally(() => { favBusy.current = null; });
  };

  /** Composed studio filters (A2.3): favorites × category × tier × axis × collection × search. */
  const styleFiltered = useMemo(() => {
    const q = styleQuery.trim().toLowerCase();
    return ALL_STYLES.filter((s) => {
      if (favOnly && !favorites.includes(s.id)) return false;
      if (styleCat !== "All" && s.category !== styleCat) return false;
      if (styleTier !== "all" && s.tier !== styleTier) return false;
      if (styleAxis !== "all" && s.axis !== styleAxis) return false;
      if (styleCollection !== "All" && s.collection !== styleCollection) return false;
      if (q) {
        const hay = `${s.name} ${s.tagline} ${s.tags.join(" ")} ${s.category} ${s.wallpaperName ?? ""} ${s.axis ?? ""} ${s.collection ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [favOnly, styleQuery, styleCat, styleTier, styleAxis, styleCollection, favorites]);

  /** Atomic apply: one mock command, one undo entry, fully revertible. */
  const applyStyle = async (s: StyleDef, opts?: { animated?: boolean }) => {
    if (applyingStyle) return;
    setApplyingStyle(s.id);
    try {
      // Deeper components (A1.6): font, sound scheme, RGB intent — applied
      // atomically by the backend with a single composite undo entry.
      const res = await applyStyleDef(s, opts);
      refreshAppliedStyle();
      refresh();
      setDetailStyle(null);
      setQuizOpen(false);
      // S6.7 — record the apply in the local history (never leaves this PC).
      recordStyleApplied(s);
      setAnalytics(getStyleAnalytics());
      toast(`Applied “${s.name}” — revert anytime from History`);
      if (res.notes?.length) toast(res.notes.join(" · "), "info");
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setApplyingStyle(null);
    }
  };

  /** S6.5 — decode a share code into a personal style and open its detail. */
  const importSharedStyle = () => {
    const err = shareCodeError(importCode);
    if (err) {
      setImportError(err);
      return;
    }
    const s = decodeStyleCode(importCode)!;
    setImportError(null);
    setImportCode("");
    setImportOpen(false);
    setDetailStyle(s);
    toast(`Imported “${s.name}” — it's yours to apply`);
  };

  const bg1 = activePack ? activePack.gradient[0] : theme ? shade(theme.accent_hex, -60) : "#0B1026";
  const bg2 = activePack ? activePack.gradient[1] : theme ? shade(theme.accent_hex, 10) : "#2A3B7C";

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Style Studio</h1>
        <p className="page-subtitle">Pick a look, preview it live, apply it in one click. Everything is undoable.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        {/* ---- Preview ---- */}
        <div>
          <Section title="Live preview" subtitle="This is what your desktop will feel like">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-strong)]">
              {/* content preview — renders the actual gradient wallpaper */}
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${bg1} 0%, ${bg2} 100%)` }} />
              <div className="absolute left-[8%] top-[14%] h-[38%] w-[42%] rounded-lg border border-white/15 bg-black/25 backdrop-blur-[2px]">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-400/80" />
                  <span className="h-2 w-2 rounded-full bg-amber-400/80" />
                  <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
                  <span className="ml-3 h-2 w-16 rounded bg-white/20" />
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="h-2 w-3/4 rounded bg-white/15" />
                  <div className="h-2 w-1/2 rounded bg-[var(--gray-4)]" />
                  <div className="h-2 w-2/3 rounded bg-[var(--gray-4)]" />
                </div>
              </div>
              <div className="absolute right-[7%] top-[26%] h-[26%] w-[28%] rounded-lg border border-white/15 bg-black/20">
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-400/80" />
                  <span className="h-2 w-2 rounded-full bg-amber-400/80" />
                  <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
                </div>
              </div>
              <div
                className="absolute bottom-0 left-0 right-0 flex h-10 items-center gap-2 border-t border-white/10 px-3"
                style={{
                  background: theme?.transparency ? "rgba(10,12,20,0.55)" : "rgba(10,12,20,0.95)",
                  backdropFilter: theme?.transparency ? "blur(8px)" : "none",
                }}
              >
                <span className="h-4 w-4 rounded-md" style={{ background: theme?.accent_hex ?? "var(--accent-hex)" }} />
                <span className="ml-1 h-4 w-4 rounded-md bg-white/15" />
                <span className="ml-auto text-2xs text-white/60">
                  {theme?.mode === "light" ? "Light" : "Dark"} · {fmt(8.1 * 1024 ** 3)} free
                </span>
              </div>
            </div>
            <p className="mt-3 text-2xs text-[var(--text-tertiary)]">
              {activePack ? `Previewing "${activePack.name}"` : "Tweak the theme controls and packs on the right to preview here."}
            </p>
          </Section>

          {/* ---- Wallpaper ---- */}
          <Section title="Wallpaper" subtitle="Static, slideshow rotation, per-monitor, and history">
            {wallpapersError && <InlineAlert>{wallpapersError}</InlineAlert>}
            {slideshowError && <InlineAlert>{slideshowError}</InlineAlert>}
            {wpHistoryError && <InlineAlert>{wpHistoryError}</InlineAlert>}
            <div className="flex gap-2">
              <input className="input" placeholder="C:\Users\you\Pictures\mountain.jpg" value={wpPath} onChange={(e) => setWpPath(e.target.value)} />
              <button className="btn-primary shrink-0" onClick={setWallpaperTarget} disabled={!wpPath.trim()}>Set wallpaper</button>
            </div>
            {wallpapers && wallpapers.monitors.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-2xs text-[var(--text-tertiary)]">Apply to:</span>
                <select value={monitorTarget} onChange={(e) => setMonitorTarget(e.target.value)}>
                  <option value="">All monitors</option>
                  {wallpapers.monitors.map((m) => (<option key={m.id} value={m.id}>{m.id}</option>))}
                </select>
              </div>
            )}

            {/* Wallpaper Gallery */}
            <WallpaperGallery
              onApply={async (publicPath, type) => {
                setWpPath(publicPath);
                if (type === "live") {
                  callWithTimeout<EngineState>("set_video_wallpaper", { source: publicPath }, IMPORT_TIMEOUT_MS)
                    .then((eng) => { refresh(); refreshVideo(); toast(`Now playing: ${eng.media?.name ?? "video"}`); })
                    .catch((e) => toast(errorCopy(e), "err"));
                } else {
                  call<WallpaperState>("set_wallpaper", { path: publicPath }).then(() => { refresh(); refreshSlideshow(); toast("Wallpaper applied"); }).catch((e) => toast(errorCopy(e), "err"));
                }
              }}
              onStyle={(w) => setDetailStyle(getStyle(naturalVariantId(w)) ?? null)}
            />

            {/* Slideshow */}
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Slideshow rotation</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">Rotate wallpapers from a folder on an interval</div>
                </div>
                <Toggle on={slideshow?.enabled ?? false} onChange={(v) => saveSlideshow({ enabled: v })} />
              </div>
              <div className="space-y-2">
                <input className="input" placeholder="C:\Users\you\Pictures\Wallpapers" value={slideshowFolder} onChange={(e) => setSlideshowFolder(e.target.value)} />
                <div className="flex items-center gap-3">
                  <span className="text-2xs text-[var(--text-tertiary)]">Every</span>
                  <select value={slideshowInterval} onChange={(e) => setSlideshowInterval(Number(e.target.value))}>
                    {[5, 10, 30, 60, 180, 360, 720, 1440].map((m) => (<option key={m} value={m}>{m} min</option>))}
                  </select>
                  <button className="btn-ghost btn-sm" onClick={() => saveSlideshow({})}>Apply</button>
                  <Toggle on={slideshow?.shuffle ?? false} onChange={(v) => saveSlideshow({ shuffle: v })} />
                  <span className="text-2xs text-[var(--text-tertiary)]">shuffle</span>
                </div>

                {/* S11.5 — smart slideshow: skip-now, day/night, favorites */}
                <div className="mt-2 flex items-center gap-3">
                  <button className="btn-ghost btn-sm" onClick={skipNow} disabled={!slideshow?.enabled}>
                    Skip now
                  </button>
                  <Toggle on={slideshow?.day_night_filter ?? false} onChange={(v) => saveSlideshow({ day_night_filter: v })} label="Day/night filter" />
                  <span className="text-2xs text-[var(--text-tertiary)]">
                    day/night{slideshow?.day_night_filter ? " (night prefers moon/dark/star-named images)" : ""}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="mb-1 text-2xs text-[var(--text-tertiary)]">Favorites — picked 3× more often</div>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="C:\Users\you\Pictures\Wallpapers\moon.jpg"
                      value={favInput}
                      onChange={(e) => setFavInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addFavorite(); }}
                      aria-label="Favorite wallpaper path"
                    />
                    <button className="btn-ghost btn-sm" onClick={addFavorite} disabled={!favInput.trim()}>Add</button>
                  </div>
                  {(slideshow?.favorites ?? []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(slideshow?.favorites ?? []).map((f) => (
                        <span key={f} className="inline-flex max-w-full items-center gap-1.5 rounded bg-[var(--surface-raised)] px-2 py-0.5 text-2xs text-[var(--text-secondary)]">
                          <span className="truncate" title={f}>{f}</span>
                          <button onClick={() => removeFavorite(f)} className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--status-danger)]" aria-label={`Remove favorite ${f}`}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Recently used */}
            {(wpHistory ?? []).length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Recently used</div>
                <div className="space-y-1">
                  {(wpHistory ?? []).slice(0, 6).map((h) => (
                    <div key={`${h.ts}-${h.path}`} className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-2xs text-[var(--text-secondary)]" title={h.path}>{h.path}</span>
                      {h.monitor_id && <span className="shrink-0 text-2xs text-[var(--text-tertiary)]">{h.monitor_id}</span>}
                      <button className="shrink-0 text-2xs text-[var(--text-secondary)] hover:underline" onClick={() => call<WallpaperState>("set_wallpaper", { path: h.path }).then(() => { refresh(); refreshSlideshow(); toast("Wallpaper restored"); }).catch((e) => toast(errorCopy(e), "err"))}>
                        Use again
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* ---- Controls ---- */}
        <div className="space-y-4">
          {/* Theme Studio */}
          <Section title="Theme Studio" subtitle="Instant, reversible tweaks" actions={<button className="btn-ghost shrink-0 text-xs" onClick={() => { resetQuiz(); setQuizOpen(true); }}>Style quiz</button>}>
            <div className="mb-4">
              <span className="label">App mode</span>
              <div className="segment">
                <button className={`segment-btn ${theme?.mode === "dark" ? "active" : ""}`} onClick={() => setMode("dark")}>Dark</button>
                <button className={`segment-btn ${theme?.mode === "light" ? "active" : ""}`} onClick={() => setMode("light")}>Light</button>
              </div>
            </div>
            <div className="mb-4">
              <span className="label">Accent color</span>
              <div className="mb-2 grid grid-cols-8 gap-2">
                {ACCENT_SUGGESTIONS.map((c) => (
                  <button key={c} onClick={() => setAccent(c)} className={`aspect-square rounded-lg transition hover:scale-105 ${theme?.accent_hex.toLowerCase() === c.toLowerCase() ? "ring-2 ring-[var(--accent-hex)] ring-offset-2 ring-offset-white" : ""}`} style={{ background: c }} aria-label={c} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-2xs text-[var(--text-tertiary)]">Custom:</label>
                <input type="color" value={theme?.accent_hex ?? "var(--accent-hex)"} onChange={(e) => setAccent(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
                <span className="font-mono text-2xs text-[var(--text-tertiary)]">{theme?.accent_hex ?? "#818cf8"}</span>
              </div>
            </div>

            {/* Color harmonics */}
            {theme?.accent_hex && (
              <div className="mb-3">
                <span className="label">Color Harmonics</span>
                <div className="space-y-1.5">
                  <div>
                    <span className="text-2xs text-[var(--text-tertiary)]">Complementary</span>
                    <div className="flex gap-1 mt-0.5">
                      <button onClick={() => setAccent(theme.accent_hex)} className="h-5 w-5 rounded-sm transition hover:scale-110" style={{ background: theme.accent_hex }} />
                      <button onClick={() => setAccent(complement(theme.accent_hex))} className="h-5 w-5 rounded-sm transition hover:scale-110" style={{ background: complement(theme.accent_hex) }} />
                    </div>
                  </div>
                  <div>
                    <span className="text-2xs text-[var(--text-tertiary)]">Analogous</span>
                    <div className="flex gap-1 mt-0.5">
                      {[analogous(theme.accent_hex, -30), theme.accent_hex, analogous(theme.accent_hex, 30)].map((c, i) => (
                        <button key={i} onClick={() => setAccent(c)} className="h-5 w-5 rounded-sm transition hover:scale-110" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-2xs text-[var(--text-tertiary)]">Triadic</span>
                    <div className="flex gap-1 mt-0.5">
                      {[theme.accent_hex, triadic(theme.accent_hex, 120), triadic(theme.accent_hex, 240)].map((c, i) => (
                        <button key={i} onClick={() => setAccent(c)} className="h-5 w-5 rounded-sm transition hover:scale-110" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)]">Translucent taskbar</div>
                <div className="text-2xs text-[var(--text-tertiary)]">Windows 11 may restrict this</div>
              </div>
              <Toggle on={theme?.transparency ?? true} onChange={setTransparency} />
            </div>
          </Section>

          {/* Color palette from accent */}
          {theme?.accent_hex && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
              <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Accent Palette</div>
              <div className="flex gap-1">
                {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => {
                  const [h, s] = hexToHsl(theme.accent_hex);
                  const lightness = 100 - (shade / 1000) * 80;
                  const saturation = s * (shade < 300 ? 0.6 : shade > 700 ? 0.8 : 1);
                  const c = hslToHex(h, saturation, lightness);
                  return (
                    <button
                      key={shade}
                      onClick={() => setAccent(c)}
                      className="flex-1 h-6 rounded-sm transition hover:scale-y-125"
                      style={{ background: c }}
                      title={`${shade}: ${c}`}
                    />
                  );
                })}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-2xs text-[var(--text-tertiary)]">Current</span>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ background: theme.accent_hex }} />
                  <span className="font-mono text-2xs text-[var(--text-secondary)]">{theme.accent_hex}</span>
                </div>
              </div>
            </div>
          )}

          {/* Current theme state summary */}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Current Theme</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-[var(--text-tertiary)]">Mode</span>
                <span className="text-2xs font-mono text-[var(--text-secondary)]">{theme?.mode ?? "dark"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-2xs text-[var(--text-tertiary)]">Transparency</span>
                <span className="text-2xs text-[var(--text-secondary)]">{theme?.transparency ? "On" : "Off"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-2xs text-[var(--text-tertiary)]">Cursor</span>
                <span className="text-2xs text-[var(--text-secondary)]">{cursorState?.scheme_source?.replace("Reforge:", "") ?? "default"}</span>
              </div>
              {engine?.active && (
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-[var(--text-tertiary)]">Live wallpaper</span>
                  <span className="badge badge-accent">Active</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick undo history */}
          <QuickHistory />

          {/* Cursor */}
      <div ref={cursorRef}>
          <Section title="Cursor scheme" subtitle={cursorState?.scheme_source || "Current: system default"}>
            {cursorSchemesError && <InlineAlert>{cursorSchemesError}</InlineAlert>}
            {cursorStateError && <InlineAlert>{cursorStateError}</InlineAlert>}
            <div className="space-y-2">
              {(cursorSchemes ?? []).map((s) => (
                <button key={s.id} onClick={() => applyCursor(s.id)} className={`w-full rounded-xl border px-4 py-2.5 text-left transition-colors ${cursorState?.scheme_source === `Reforge:${s.id}` ? "border-[var(--border-accent)] bg-[var(--surface-selected)]" : "border-[var(--border-default)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-hover)]"}`}>
                  <div className="text-sm font-medium text-[var(--text-primary)]">{s.name}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">{s.description}</div>
                </button>
              ))}
            </div>
          </Section>
      </div>

          {/* Style Studio — the Style Engine catalog */}
          <Section title="Style Studio" subtitle={`${STYLE_COUNT.total} complete looks — ${STYLE_COUNT.flagship} flagships, ${STYLE_COUNT.library} library variants, ${STYLE_COUNT.scene} animated scenes`} actions={
            <div className="flex items-center gap-1.5">
              <button className={`btn-ghost shrink-0 text-2xs ${importOpen ? "!border-[var(--border-accent)] !text-[var(--accent-hex)]" : ""}`} onClick={() => setImportOpen((v) => !v)}>Import code</button>
              <button className="btn-ghost shrink-0 text-2xs" onClick={() => { resetQuiz(); setQuizOpen(true); }}>Style quiz</button>
            </div>
          }>
            {appliedStyleError && <InlineAlert>{appliedStyleError}</InlineAlert>}
            {favoritesError && <InlineAlert>{favoritesError}</InlineAlert>}
            {/* S6.7 — most-used looks + honest palette insight (local only) */}
            {analytics.mostUsed.length > 0 && (
              <div className="mb-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2.5">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Most-used looks</span>
                  <span className="text-2xs text-[var(--text-tertiary)]">local history — never leaves this PC</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analytics.mostUsed.map((m) => {
                    const s = getStyle(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => { if (s) setDetailStyle(s); }}
                        disabled={!s}
                        className={`rounded-full px-2.5 py-1 text-2xs transition-colors ${s ? "bg-[var(--surface-overlay)] text-[var(--text-secondary)] hover:border-[var(--border-accent)] hover:text-[var(--accent-hex)] border border-[var(--border-default)]" : "cursor-default bg-[var(--surface-overlay)] text-[var(--text-tertiary)] border border-transparent"}`}
                        title={s ? "Open this look" : "This look is no longer in the catalog"}
                      >
                        {m.name} <span className="ml-1 opacity-70">×{m.count}</span>
                      </button>
                    );
                  })}
                </div>
                {analytics.insight && <p className="mt-1.5 text-2xs text-[var(--text-secondary)]">{analytics.insight}</p>}
              </div>
            )}
            {/* S6.5 — import a shared style from a code */}
            {importOpen && (
              <div className="mb-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2.5">
                <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Import a shared style</div>
                <div className="flex gap-1.5">
                  <input
                    className="input flex-1 !text-xs"
                    placeholder="10-character share code (digits + A–Z)"
                    value={importCode}
                    onChange={(e) => { setImportCode(e.target.value); setImportError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") importSharedStyle(); }}
                    spellCheck={false}
                  />
                  <button className="btn-primary btn-sm shrink-0" onClick={importSharedStyle} disabled={!importCode.trim()}>Import</button>
                </div>
                {importError && <p className="mt-1.5 text-2xs text-[var(--status-danger-text)]">{importError}</p>}
              </div>
            )}
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1">
                <IconSearch size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input className="input !pl-8" placeholder="Search styles…" value={styleQuery} onChange={(e) => setStyleQuery(e.target.value)} />
              </div>
              <button
                className={`btn-ghost shrink-0 btn-sm ${favOnly ? "!border-[var(--border-accent)] !text-[var(--accent-hex)]" : ""}`}
                onClick={() => setFavOnly(!favOnly)}
                title="Favorites only"
              >
                <IconStar size={12} className={favOnly ? "fill-[var(--accent-hex)] text-[var(--accent-hex)]" : ""} /> {favorites.length}
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {STYLE_CATEGORIES.map((c) => (
                <button key={c} onClick={() => setStyleCat(c)} className={`rounded-full px-3 py-1 text-2xs transition-colors ${styleCat === c ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>{c}</button>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {([["all", "All tiers"], ["flagship", "Flagships"], ["library", "Library"], ["scene", "Scenes"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setStyleTier(k)} className={`rounded-full px-3 py-1 text-2xs transition-colors ${styleTier === k ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>{label}</button>
              ))}
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {([["all", "All axes"], ["natural", "Natural"], ["vivid", "Vivid"], ["minimal", "Minimal"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setStyleAxis(k)} className={`rounded-full px-3 py-1 text-2xs transition-colors ${styleAxis === k ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>{label}</button>
              ))}
              <select className="ml-auto rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] px-2 py-1 text-2xs text-[var(--text-secondary)]" value={styleCollection} onChange={(e) => setStyleCollection(e.target.value)}>
                <option value="All">All collections</option>
                {STYLE_COLLECTIONS.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {styleFiltered.slice(0, 24).map((s) => (
                <div key={s.id} role="button" tabIndex={0} onClick={() => setDetailStyle(s)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailStyle(s); } }} onMouseEnter={() => setHoverStyle(s.id)} onMouseLeave={() => setHoverStyle((h) => (h === s.id ? null : h))} onFocus={() => setHoverStyle(s.id)} onBlur={() => setHoverStyle((h) => (h === s.id ? null : h))} className={`group relative cursor-pointer overflow-hidden rounded-lg border text-left transition-colors hover:border-[var(--border-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-hex)] ${appliedStyleId === s.id ? "border-[var(--status-success-border)]" : "border-[var(--border-default)]"}`}>
                  {/* C3 content preview — static gradient until hovered, then the style's animated scene plays live */}
                  {hoverStyle === s.id ? (
                    <div className="relative h-14 w-full overflow-hidden">
                      <ScenePreview kind={sceneConfigForStyle(s).kind} colors={sceneConfigForStyle(s).colors} speed={sceneConfigForStyle(s).speed} density={sceneConfigForStyle(s).density} className="h-full w-full" />
                    </div>
                  ) : (
                    // content preview — renders the actual gradient wallpaper
                    <div className="h-14 w-full" style={{ background: `linear-gradient(135deg, ${s.gradient[0]}, ${s.gradient[1]})` }} />
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFav(s.id); }}
                    className={`absolute right-1.5 top-1.5 h-6 w-6 rounded-md bg-black/35 p-1 text-white/80 transition-colors hover:text-white ${favorites.includes(s.id) ? "!text-amber-300" : "opacity-0 group-hover:opacity-100"}`}
                    title={favorites.includes(s.id) ? "Remove from favorites" : "Add to favorites"}
                  >
                    <IconStar size={13} className={favorites.includes(s.id) ? "fill-amber-300" : ""} />
                  </button>
                  <div className="p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-semibold text-[var(--text-primary)]" title={s.name}>{s.name}</span>
                      <span className="shrink-0 badge badge-neutral !text-2xs">{s.axis ?? s.tier}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-2xs text-[var(--text-tertiary)]" title={s.tagline}>{s.tagline}</div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.accent_hex }} />
                      <span className="text-2xs uppercase text-[var(--text-tertiary)]">{s.mode}</span>
                      <span className="ml-auto text-2xs font-medium text-[var(--text-secondary)]">
                        {applyingStyle === s.id ? "Applying…" : appliedStyleId === s.id ? "Applied" : "Details"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {styleFiltered.length > 24 && (
              <p className="mt-2 text-2xs text-[var(--text-tertiary)]">Showing 24 of {styleFiltered.length} — use search or filters to narrow.</p>
            )}
            {styleFiltered.length === 0 && (
              <p className="mt-2 text-2xs text-[var(--text-tertiary)]">No styles match those filters.</p>
            )}

            {/* Classic backend packs */}
            {packs.length > 0 && (
              <div className="mt-4 border-t border-[var(--border-default)] pt-3">
                <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Classic packs</div>
                <div className="grid grid-cols-2 gap-2">
                  {packs.map((p) => (
                    <button key={p.id} onClick={() => applyPack(p)} disabled={applying !== null} className={`group overflow-hidden rounded-lg border text-left transition-colors hover:border-[var(--border-accent)] ${activePack?.id === p.id ? "border-[var(--border-accent)]" : "border-[var(--border-default)]"}`}>
                      {/* content preview — renders the actual gradient wallpaper */}
                      <div className="h-14 w-full" style={{ background: `linear-gradient(135deg, ${p.gradient[0]}, ${p.gradient[1]})` }} />
                      <div className="p-2">
                        <div className="truncate text-xs font-semibold text-[var(--text-primary)]" title={p.name}>{p.name}</div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.accent_hex }} />
                          <span className="text-2xs font-medium text-[var(--text-secondary)]">{applying === p.id ? "Applying…" : activePack?.id === p.id ? "Applied" : "Apply"}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {packs.length === 0 && (
              <div className="mt-4 border-t border-[var(--border-default)] pt-3">
                <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Classic packs</div>
                <p className="text-xs text-[var(--text-tertiary)]">No packs installed yet — capture your current look in Marketplace and it'll show up here.</p>
              </div>
            )}

            {/* F-C: remix mode — independent wallpaper/accent/mode pickers */}
            <StyleStudioRemix scenes={scenes ?? []} theme={theme} />
          </Section>
        </div>
      </div>

      {/* ---- Animated Wallpaper Engine ---- */}
      <div ref={engineRef}>
      <Section title="Animated Wallpaper Engine" subtitle="Living, breathing desktops — procedural scenes render behind your icons" actions={<div className="flex gap-2"><button className="btn-ghost shrink-0 text-2xs" onClick={() => setStudioOpen(true)}>Wallpaper Studio</button>{engine?.active ? (<><button className="btn-ghost shrink-0 text-2xs" onClick={() => freezeScene(!engine.frozen)}>{engine.frozen ? <><IconPlay size={11} /> Resume</> : <><IconPause size={11} /> Freeze</>}</button><button className="btn-danger shrink-0 text-2xs" disabled={engineBusy} onClick={stopScene}><IconPower size={11} /> Stop</button></>) : (<span className="badge badge-neutral">Not running</span>)}</div>}>
        {engineError && <InlineAlert>{engineError}</InlineAlert>}
        {scenesError && <InlineAlert>{scenesError}</InlineAlert>}
        {engine?.active && (
          <div className="mb-3 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success)]">
            <StatusDot status="success" pulse /> {engine.scene?.name ?? "Scene"} is live{engine.frozen ? " (frozen)" : ""}
          </div>
        )}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["all", "calm", "energetic", "nature", "space", "seasonal"].map((m) => (
            <button key={m} onClick={() => setMoodFilter(m)} className={`rounded-full px-3 py-1 text-xs capitalize transition-colors ${moodFilter === m ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>
              {m}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {(scenes ?? []).filter((s) => moodFilter === "all" || s.mood === moodFilter).map((s) => (
            <div key={s.id} onMouseEnter={() => setHoverScene(s.id)} onMouseLeave={() => setHoverScene((h) => (h === s.id ? null : h))} className={`group relative overflow-hidden rounded-xl border text-left transition-colors ${engine?.scene?.id === s.id ? "border-[var(--status-success-border)]" : "border-[var(--border-default)] hover:border-[var(--border-accent)]"}`}>
              <button onClick={() => applyScene(s)} disabled={engineBusy} className="w-full">
                <div className="h-24 w-full overflow-hidden">
                  {hoverScene === s.id ? (
                    <ScenePreview kind={s.kind} colors={s.colors} speed={s.speed} density={s.density} className="h-full w-full" />
                  ) : (
                    // static color story until hovered — zero canvases on load (S7.6)
                    <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${s.colors[1] ?? s.colors[0]}, ${s.colors[0]})` }} />
                  )}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-xs font-semibold text-[var(--text-primary)]" title={s.name}>{s.name}</div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-2xs capitalize text-[var(--text-tertiary)]">{s.kind}</span>
                    {engine?.scene?.id === s.id ? <span className="badge badge-success">LIVE</span> : <span className="text-2xs text-[var(--text-secondary)]">Apply</span>}
                  </div>
                </div>
              </button>
              {s.id.startsWith("custom-") && (
                <button
                  onClick={() => deleteCustomScene(s)}
                  className="absolute right-1.5 top-1.5 rounded-md bg-black/45 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                  title="Delete custom scene"
                >
                  <IconTrash size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </Section>
      </div>

      {/* ---- Screensaver ---- */}
      <div ref={screensaverRef}>
      <Section title="Screensaver" subtitle="Your scenes as a real Windows screensaver — registers SCRNSAVE, opens fullscreen on idle, any input exits" actions={
        <div className="flex gap-2">
          <button className="btn-ghost shrink-0 text-2xs" disabled={screensaverBusy || !shownSsCfg?.enabled} onClick={previewScreensaver}><IconPlay size={11} /> Preview now</button>
          <Toggle on={shownSsCfg?.enabled ?? false} onChange={(v) => saveScreensaver({ enabled: v })} />
        </div>
      }>
        {screensaverCfgError && <InlineAlert>{screensaverCfgError}</InlineAlert>}
        {shownSsCfg?.enabled && screensaverReg && !screensaverReg.active && (
          <div className="mb-3 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
            Windows is not showing the screensaver as active — check the system screensaver dialog.
          </div>
        )}
        {shownSsCfg?.enabled && (
          <div className="mb-3 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-xs text-[var(--status-success)]">
            <StatusDot status="success" pulse /> Armed — activates after {shownSsCfg.timeout_secs}s of idle
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Idle timeout (seconds)
            <input
              type="number" min={1} max={3600}
              value={shownSsCfg?.timeout_secs ?? 300}
              onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 300); saveScreensaver({ timeout_secs: v }); }}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            Scene
            <select
              value={screensaverSceneId || shownSsCfg?.scene?.id || ""}
              onChange={(e) => {
                const id = e.target.value;
                setScreensaverSceneId(id);
                const scene = (scenes ?? []).find((s) => s.id === id);
                // Don't null the saved scene if the list hasn't loaded yet.
                if (scene || id === "") saveScreensaver({ scene: scene ?? null });
              }}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">Current engine scene</option>
              {(scenes ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col justify-end text-xs text-[var(--text-tertiary)]">
            Move the mouse or press any key to exit — fullscreen, always-on-top, zero chrome.
          </div>
        </div>
      </Section>
      </div>

      {/* ---- Video / GIF wallpaper ---- */}
      <div ref={videoRef}>
      <Section title="Video & GIF wallpaper" subtitle="Loop a video or animated image — MP4, WebM and GIF, normalized on import" actions={engine?.media ? (<button className="btn-danger shrink-0 text-xs" disabled={videoBusy} onClick={stopVideoWallpaper}><IconPower size={12} /> Stop video</button>) : undefined}>
        {videoError && <InlineAlert>{videoError}</InlineAlert>}
        {transcodeError && <InlineAlert>{transcodeError}</InlineAlert>}
        <div className="mb-3 flex gap-2">
          <input className="input" placeholder="C:\videos\aurora.mp4" value={videoPath} onChange={(e) => setVideoPath(e.target.value)} />
          <button className="btn-primary shrink-0" onClick={setVideoWallpaper} disabled={videoBusy || !videoPath.trim()}>{videoBusy ? "Importing…" : "Set video"}</button>
        </div>
        {videoBusy && transcodeNote && (
          <div className="mb-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-hex)]" />
            {transcodeNote}
          </div>
        )}
        {transcode && !transcode.available && (
          <div className="mb-3 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
            ffmpeg isn't bundled — videos play without normalization.
          </div>
        )}
        {engine?.media && (
          <div className="mb-3 rounded-xl border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 py-2.5 text-sm text-[var(--status-success)]">
            <StatusDot status="success" pulse /> Now playing: <b>{engine.media.name}</b> ({engine.media.width}×{engine.media.height})
          </div>
        )}
        {!videoError && (videoWallpapers ?? []).length > 0 && (
          <>
            <div className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Imported media</div>
            <div className="flex flex-wrap gap-2">
              {(videoWallpapers ?? []).map((v) => (
                <button key={v.path} onClick={() => call<EngineState>("set_video_wallpaper", { source: v.path }).then(() => { refreshEngine(); toast(`Video → ${v.name}`); }).catch((e) => toast(errorCopy(e), "err"))} className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${engine?.media?.path === v.path ? "border-[var(--status-success-border)] bg-[var(--status-success-bg)]" : "border-[var(--border-default)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-hover)]"}`}>
                  <div className="font-medium text-[var(--text-primary)]">{v.name}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">{v.kind} · {v.width}×{v.height}</div>
                </button>
              ))}
            </div>
          </>
        )}
        {!videoError && (videoWallpapers ?? []).length === 0 && (
          <div className="empty-state">
            No imported videos yet — paste a path above to loop an MP4, WebM or GIF.
          </div>
        )}
      </Section>
      </div>

      {/* ---- Widget Engine ---- */}
      <div ref={widgetsRef}>
      <Section title="Widget Engine" subtitle="Desktop widgets — clock, stats, notes, to-do, calendar, battery, toggles, world clock, agenda" actions={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {["clock", "stats", "note", "todo", "calendar", "battery", "toggles", "worldclock", "agenda"].map((k) => (
            <button key={k} className="btn-ghost btn-sm capitalize" onClick={() => createWidget(k)}><IconPlus size={12} /> {k}</button>
          ))}
          {(widgets ?? []).length > 0 && (
            <button className="btn-ghost btn-sm" onClick={resetWidgetLayout} title="Snap every widget back to the default grid (undoable)">
              Reset layout
            </button>
          )}
        </div>
      }>
        {widgetsError && <InlineAlert>{widgetsError}</InlineAlert>}
        {!widgetsError && (widgets ?? []).length === 0 && (
          <div className="empty-state">No widgets yet. Add a clock, stats meter, sticky note, to-do list, or calendar.</div>
        )}
        {!widgetsError && (widgets ?? []).length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(widgets ?? []).map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium capitalize text-[var(--text-primary)]">{w.kind}</div>
                  <div className="text-2xs text-[var(--text-tertiary)]">{w.visible ? "on desktop" : "hidden"}</div>
                </div>
                <Toggle on={w.visible} onChange={(v) => toggleWidget(w, v)} />
                <button className="text-[var(--text-tertiary)] hover:text-[var(--status-danger)]" onClick={() => removeWidget(w)}><IconTrash size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] px-3 py-2">
          <div>
            <div className="text-xs font-medium text-[var(--text-primary)]">Auto-hide on fullscreen</div>
            <div className="text-2xs text-[var(--text-tertiary)]">Widgets duck while a fullscreen app or game has focus — re-show when you return to the desktop</div>
          </div>
          <Toggle on={widgetsSettings?.autohide_fullscreen ?? true} onChange={(v) => saveWidgetsSettings({ autohide_fullscreen: v })} />
        </div>
      </Section>
      </div>

      {/* ---- Widget board preview (S9.6) ---- */}
      <div ref={boardRef}>
      <Section title="Widget board" subtitle="A live desktop mock — widgets at their real positions, scaled to fit">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-[var(--border-default)] bg-[#0b1220]">
          {engine?.scene && engine.scene.kind && engine.scene.colors.length >= 2 ? (
            <ScenePreview kind={engine.scene.kind} colors={engine.scene.colors} speed={engine.scene.speed} density={engine.scene.density} className="absolute inset-0 h-full w-full" />
          ) : (
            <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)" }} />
          )}
          <div className="absolute bottom-0 left-0 right-0 h-[6%] bg-black/45" />
          {(widgets ?? []).filter((w) => w.visible).map((w) => (
            <div
              key={w.id}
              className="absolute rounded-lg border border-white/15 bg-[rgba(10,14,28,0.72)] px-2 py-1 text-2xs text-white/90 shadow-md"
              style={{
                left: `${(w.x / 1920) * 100}%`,
                top: `${(w.y / 1080) * 100}%`,
                width: `${Math.max((w.w / 1920) * 100, 4)}%`,
              }}
              title={`${w.kind} at ${Math.round(w.x)},${Math.round(w.y)}`}
            >
              <span className="font-medium capitalize">{w.kind}</span>
            </div>
          ))}
          {(widgets ?? []).filter((w) => w.visible).length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">No visible widgets — add one above</div>
          )}
        </div>
      </Section>
      </div>

      {/* ---- Taskbar redesigner ---- */}
      <div ref={taskbarRef}>
      <Section title="Taskbar redesigner" subtitle="Size, alignment, auto-hide & color-match — registry-backed" actions={pendingShell?.pending ? (<div className="flex gap-2"><button className="btn-ghost shrink-0 text-xs" onClick={revertPending}>↩ Revert</button><button className="btn-primary shrink-0 text-xs" onClick={applyPendingRestart}>↻ Restart Explorer</button></div>) : undefined}>
        {taskbarError && <InlineAlert>{taskbarError}</InlineAlert>}
        {pendingError && <InlineAlert>{pendingError}</InlineAlert>}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-medium text-[var(--text-secondary)]">Icon size</div></div>
            <div className="segment">{["small", "medium", "large"].map((s) => (<button key={s} onClick={() => setTaskbarSize(s)} className={`segment-btn ${taskbar?.size === s ? "active" : ""}`}>{s}</button>))}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-medium text-[var(--text-secondary)]">Alignment</div></div>
            <div className="segment">{["center", "left"].map((a) => (<button key={a} onClick={() => setTaskbarAlign(a)} className={`segment-btn ${taskbar?.alignment === a ? "active" : ""}`}>{a}</button>))}</div>
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-sm font-medium text-[var(--text-secondary)]">Auto-hide</div></div>
            <Toggle on={taskbar?.autohide ?? false} onChange={setTaskbarAutohide} />
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-sm font-medium text-[var(--text-secondary)]">Match accent color</div></div>
            <Toggle on={taskbar?.color_match ?? false} onChange={setTaskbarColorMatch} />
          </div>
          {caps?.taskbar_reposition_supported ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-sm font-medium text-[var(--text-secondary)]">Position</div><div className="text-2xs text-[var(--text-tertiary)]">Windows 10 only</div></div>
              <div className="segment">{["bottom", "top", "left", "right"].map((s) => (<button key={s} onClick={() => setTaskbarPosition(s)} className="segment-btn">{s}</button>))}</div>
            </div>
          ) : (
            // S3.10 — capability-gated dead controls: when the OS can't
            // reposition the taskbar (Win11), show a disabled explainer
            // instead of a live-looking control or a silent gap.
            <div className="flex flex-wrap items-center justify-between gap-3 opacity-60">
              <div><div className="text-sm font-medium text-[var(--text-secondary)]">Position</div><div className="text-2xs text-[var(--text-tertiary)]">Windows 10 only — not available on this Windows version</div></div>
              <div className="segment" aria-disabled="true">{["bottom", "top", "left", "right"].map((s) => (<button key={s} disabled className="segment-btn">{s}</button>))}</div>
            </div>
          )}
          {pendingShell?.pending ? (
            <div className="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
              {pendingShell.changes.length} change(s) queued. Restart Explorer to apply, or revert.
            </div>
          ) : (
            <p className="text-2xs text-[var(--text-tertiary)]">Changes queue up and apply together on one Explorer restart.</p>
          )}
        </div>
      </Section>
      </div>

      {/* ---- Sound scheme editor ---- */}
      <div ref={soundsRef}>
      <Section title="Sound scheme editor" subtitle="Windows system sounds — per-user, applied immediately">
        {schemesError && <InlineAlert>{schemesError}</InlineAlert>}
        {soundEventsError && <InlineAlert>{soundEventsError}</InlineAlert>}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(schemes ?? []).map((s) => (<button key={s.guid} onClick={() => applyScheme(s.guid)} className={`rounded-full px-3 py-1 text-xs transition-colors ${s.current ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>{s.name}</button>))}
          {!schemesError && (schemes ?? []).length === 0 && <span className="text-2xs text-[var(--text-tertiary)]">No schemes detected.</span>}
        </div>
        <div className="mb-4 flex gap-2">
          <input className="input" placeholder="Save current sounds as a scheme…" value={schemeName} onChange={(e) => setSchemeName(e.target.value)} />
          <button className="btn-ghost btn-sm shrink-0" onClick={saveScheme} disabled={!schemeName.trim()}>Save scheme</button>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(soundEvents ?? []).map((evt) => (
            <div key={evt.event} className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2">
              <span className="flex-1 truncate text-xs text-[var(--text-secondary)]" title={evt.label}>{evt.label}</span>
              {evt.has_sound && <button className="text-2xs text-[var(--text-secondary)] hover:underline" onClick={() => previewSound(evt.current)}>Preview</button>}
              <button className="text-2xs text-[var(--text-tertiary)] hover:text-[var(--status-danger)]" onClick={() => setEventSound(evt.event, "")}>Clear</button>
            </div>
          ))}
        </div>
      </Section>
      </div>

      {/* ---- System font replacer ---- */}
      <div ref={fontsRef}>
      <Section title="System font replacer" subtitle="Swap the UI font via FontSubstitutes — needs admin">
        {fontSubsError && <InlineAlert>{fontSubsError}</InlineAlert>}
        {installedFontsError && <InlineAlert>{installedFontsError}</InlineAlert>}
        {capsError && <InlineAlert>{capsError}</InlineAlert>}
        {caps && !caps.admin && (
          <div className="mb-3 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
            Font substitution needs admin. Relaunch elevated.
          </div>
        )}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1"><span className="label">Replace font</span><input className="input" list="font-list" value={fontOriginal} onChange={(e) => setFontOriginal(e.target.value)} /></div>
            <div className="min-w-40 flex-1"><span className="label">With</span><input className="input" list="font-list" placeholder="e.g. Segoe UI Variable" value={fontSubstitute} onChange={(e) => setFontSubstitute(e.target.value)} /></div>
            <button className="btn-primary shrink-0" onClick={applyFontSub}>Apply</button>
          </div>
          <datalist id="font-list">{(installedFonts ?? []).map((f) => (<option key={f.name} value={f.name} />))}</datalist>
        </div>
        <div className="mb-4 flex gap-2">
          <input className="input" placeholder="C:\fonts\MyFont.ttf" value={fontInstallPath} onChange={(e) => setFontInstallPath(e.target.value)} />
          <button className="btn-ghost btn-sm shrink-0" onClick={installFont} disabled={!fontInstallPath.trim()}>Install font</button>
        </div>
        <div className="space-y-1.5">
          {(fontSubs ?? []).map((s) => (
            <div key={s.original} className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2">
              <span className="flex-1 text-xs text-[var(--text-secondary)]">{s.original} → <b className="text-[var(--text-primary)]">{s.substituted}</b></span>
              <button className="text-2xs text-[var(--text-tertiary)] hover:text-[var(--status-danger)]" onClick={() => call<FontSubstitution[]>("set_font_substitution", { original: s.original, substitute: "" }).then(() => refreshFontSubs()).catch((e) => toast(errorCopy(e), "err"))}>Reset</button>
            </div>
          ))}
          {!fontSubsError && (fontSubs ?? []).length === 0 && <p className="text-2xs text-[var(--text-tertiary)]">No font substitutions active.</p>}
        </div>
        {(installedFonts ?? []).filter((f) => f.source === "user").length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Your user fonts</div>
            {(installedFonts ?? []).filter((f) => f.source === "user").map((f) => (
              <div key={f.name} className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2">
                <span className="flex-1 text-xs text-[var(--text-secondary)]">{f.name}</span>
                <button className="text-2xs text-[var(--text-tertiary)] hover:text-[var(--status-danger)]" onClick={() => removeFont(f.name)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </Section>
      </div>

      {/* ---- Lock screen designer ---- */}
      <div ref={lockRef}>
      <Section title="Lock screen designer" subtitle="Image, slideshow or spotlight — no admin needed">
        {lockScreenError && <InlineAlert>{lockScreenError}</InlineAlert>}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[{ id: "image", label: "Single image" }, { id: "slideshow", label: "Slideshow" }, { id: "spotlight", label: "Spotlight" }].map((m) => (
            <button key={m.id} onClick={() => (m.id === "image" ? setLsImage() : m.id === "slideshow" ? setLsSlideshow() : setLsSpotlight())} className={`rounded-full px-3 py-1 text-xs transition-colors ${lockScreen?.mode === m.id ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>{m.label}</button>
          ))}
        </div>
        <div className="mb-3 flex gap-2">
          <input className="input" placeholder="C:\pictures\lock.png (image mode)" value={lsImagePath} onChange={(e) => setLsImagePath(e.target.value)} />
          <button className="btn-ghost btn-sm shrink-0" onClick={setLsImage} disabled={!lsImagePath.trim()}>Set image</button>
        </div>
        <div className="mb-3 space-y-2 rounded-xl bg-[var(--surface-overlay)] p-3">
          <div className="flex gap-2">
            <input className="input" placeholder="C:\pictures\slideshow (folder)" value={lsFolder} onChange={(e) => setLsFolder(e.target.value)} />
            <button className="btn-ghost btn-sm shrink-0" onClick={setLsSlideshow} disabled={!lsFolder.trim()}>Use folder</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xs text-[var(--text-tertiary)]">Interval</span>
            <select value={lsInterval} onChange={(e) => setLsInterval(Number(e.target.value))}>
              {[10, 30, 60, 180, 360, 720, 1440].map((m) => (<option key={m} value={m}>{m} min</option>))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div><div className="text-sm font-medium text-[var(--text-secondary)]">Hide detailed status</div></div>
          <Toggle on={lockScreen?.hide_apps ?? false} onChange={setLsHideApps} />
        </div>
      </Section>
      </div>

      {/* ---- Roadmap (honest) ---- */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {[
          { title: "Window FX", desc: "Blur, transparency, rounded corners & animation speed." },
          { title: "Right-click cleaner", desc: "Tidy context menus and theme them." },
          { title: "Folder color-coding", desc: "Color your folders for instant recognition." },
          { title: "Animated screensaver", desc: "Turn any scene into a screensaver." },
          { title: "Login / boot skinning", desc: "OS-blocked in Win11 — needs third-party tooling." },
        ].map((c) => (
          <div key={c.title} className="card p-4 opacity-60">
            <div className="text-sm font-semibold text-[var(--text-primary)]">{c.title}</div>
            <p className="mt-1 text-2xs text-[var(--text-tertiary)]">{c.desc}</p>
            <div className="mt-2 text-2xs text-[var(--text-tertiary)]">On roadmap</div>
          </div>
        ))}
      </div>

      {/* ---- Modals ---- */}
      <Modal open={studioOpen} title="Wallpaper Studio — build your own scene" onClose={() => setStudioOpen(false)} onConfirm={applyStudio} confirmLabel="Apply to desktop">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[var(--border-strong)]">
            <ScenePreview kind={studio.kind} colors={studio.colors} speed={studio.speed} density={studio.density} className="h-32 w-full" />
          </div>
          <div>
            <span className="label">Template (A6.1 — 14 kinds)</span>
            <div className="grid grid-cols-4 gap-1.5">
              {["particles", "waves", "geometric", "parallax", "aurora", "stars", "embers", "rain", "fireflies", "snowfall-wind", "bokeh", "smoke", "waves-3d"].map((k) => (
                <button key={k} onClick={() => setStudio({ ...studio, kind: k })} className={`segment-btn ${studio.kind === k ? "active" : ""}`}>{k}</button>
              ))}
            </div>
          </div>
          <div><span className="label">Speed · {studio.speed.toFixed(1)}x</span><input type="range" min={0.2} max={3} step={0.1} value={studio.speed} onChange={(e) => setStudio({ ...studio, speed: +e.target.value })} className="w-full" /></div>
          <div><span className="label">Density · {studio.density.toFixed(1)}x</span><input type="range" min={0.2} max={2} step={0.1} value={studio.density} onChange={(e) => setStudio({ ...studio, density: +e.target.value })} className="w-full" /></div>
          <div>
            <span className="label">Colors</span>
            <div className="flex gap-2">
              {studio.colors.map((c, i) => (
                <input key={i} type="color" value={c} onChange={(e) => { const colors = [...studio.colors]; colors[i] = e.target.value; setStudio({ ...studio, colors }); }} className="h-9 w-14 cursor-pointer rounded-lg border-0 bg-transparent" />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["complement", "analogous", "triadic"].map((mode) => (
                <button
                  key={mode}
                  className="btn-ghost btn-sm capitalize"
                  title={`Fill with the ${mode} palette of the first color`}
                  onClick={() => {
                    const base = studio.colors[0] ?? "#818cf8";
                    const pal = mode === "complement" ? [base, complement(base)] : mode === "analogous" ? [analogous(base, -40), base, analogous(base, 40)] : [base, triadic(base, 120), triadic(base, 240)];
                    setStudio({ ...studio, colors: pal.slice(0, 3) });
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={studio.name === "My Scene" ? "" : studio.name}
              placeholder="Scene name (saves a custom scene)"
              onChange={(e) => setStudio({ ...studio, name: e.target.value.trim() || "My Scene" })}
            />
            <button className="btn-ghost btn-sm shrink-0" onClick={saveStudioScene} disabled={studio.name === "My Scene"}>
              Save custom
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={quizOpen} title="Style match quiz" onClose={() => setQuizOpen(false)}>
        {quizDone ? (
          <div>
            <div className="mb-3 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Your top 3 matches</div>
            <div className="space-y-2">
              {quizResults.map((s, i) => (
                <div key={s.id} className={`rounded-xl border p-3 ${i === 0 ? "border-[var(--border-accent)]" : "border-[var(--border-default)]"}`}>
                  <div className="flex items-center gap-3">
                    {/* content preview — renders the actual gradient wallpaper */}
                    <div className="h-12 w-16 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${s.gradient[0]}, ${s.gradient[1]})` }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]" title={`${i + 1}. ${s.name}`}>{i + 1}. {s.name}</div>
                      <div className="truncate text-2xs text-[var(--text-tertiary)]" title={s.tagline}>{s.tagline}</div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-active)]">
                        <div className="h-full rounded-full bg-[var(--accent-hex)]" style={{ width: `${Math.min(100, Math.round((scoreStyle(s, answers) / 28) * 100))}%` }} />
                      </div>
                    </div>
                  </div>
                  <button className="btn-primary mt-2.5 w-full !h-7 text-xs" onClick={() => applyStyle(s)} disabled={applyingStyle !== null}>
                    {applyingStyle === s.id ? "Applying…" : appliedStyleId === s.id ? `Re-apply “${s.name}”` : `Apply “${s.name}”`}
                  </button>
                </div>
              ))}
            </div>
            {myStyle && (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--border-strong)] p-3">
                <div className="flex items-center gap-3">
                  {/* content preview — renders the actual gradient wallpaper */}
                  <div className="h-12 w-16 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${myStyle.gradient[0]}, ${myStyle.gradient[1]})` }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Your personal style</div>
                    <div className="truncate text-2xs text-[var(--text-tertiary)]" title={`Built from your answers — ${myStyle.mode} mode, ${myStyle.accent_hex} accent, ${myStyle.wallpaperName ?? "a living scene"}`}>Built from your answers — {myStyle.mode} mode, {myStyle.accent_hex} accent, {myStyle.wallpaperName ?? "a living scene"}</div>
                  </div>
                </div>
                <button className="btn-ghost mt-2.5 w-full !h-7 text-xs" onClick={() => { setDetailStyle(myStyle); setQuizOpen(false); }}>Preview & apply</button>
              </div>
            )}
            <button className="mt-3 w-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]" onClick={resetQuiz}>Retake the quiz</button>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Question {quizStep + 1} of {QUIZ.length}</span>
              <div className="flex gap-1">{QUIZ.map((_, i) => (<span key={i} className={`h-1 w-3.5 rounded-full transition-colors ${i <= quizStep ? "bg-[var(--accent-hex)]" : "bg-[var(--surface-active)]"}`} />))}</div>
            </div>
            <p className="mb-4 text-base font-medium text-[var(--text-primary)]">{QUIZ[quizStep].q}</p>
            <div className="space-y-2">
              {QUIZ[quizStep].options.map((opt, i) => (
                <button key={i} onClick={() => pickQuiz(i)} className="flex w-full items-center gap-3 rounded-lg border border-[var(--border-default)] px-4 py-2.5 text-left transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--surface-hover)]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--text-tertiary)]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">{opt.label}</span>
                    {opt.sub && <span className="block text-2xs text-[var(--text-tertiary)]">{opt.sub}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Style detail modal */}
      <Modal
        open={detailStyle !== null}
        title={detailStyle?.name ?? "Style"}
        onClose={() => setDetailStyle(null)}
        onConfirm={() => { if (detailStyle) applyStyle(detailStyle, { animated: animOn }); }}
        confirmLabel={animOn ? "Apply with animated wallpaper" : "Apply this style"}
      >
        {detailStyle && (
          <div>
            {/* Static / Animated toggle — every style has an animated twin (B2.3) */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Wallpaper</div>
              <div className="segment">
                <button className={`segment-btn ${!animOn ? "active" : ""}`} onClick={() => setAnimOn(false)}>Static</button>
                <button className={`segment-btn ${animOn ? "active" : ""}`} onClick={() => setAnimOn(true)}>Animated</button>
              </div>
            </div>
            {animOn ? (
              <div className="mb-3 h-24 w-full overflow-hidden rounded-lg border border-[var(--border-strong)]">
                <ScenePreview kind={sceneConfigForStyle(detailStyle).kind} colors={sceneConfigForStyle(detailStyle).colors} speed={sceneConfigForStyle(detailStyle).speed} density={sceneConfigForStyle(detailStyle).density} className="h-full w-full" />
              </div>
            ) : (
              // content preview — renders the actual gradient wallpaper
              <div className="mb-3 h-24 w-full rounded-lg" style={{ background: `linear-gradient(135deg, ${detailStyle.gradient[0]}, ${detailStyle.gradient[1]})` }} />
            )}
            {animOn && detailStyle.wallpaper.type === "live" && (
              <p className="mb-2 text-2xs text-[var(--text-tertiary)]">Animated mode uses a living scene instead of the looping video — lighter on GPU.</p>
            )}
            <p className="mb-1 text-sm font-medium text-[var(--text-primary)]">{detailStyle.tagline}</p>
            <p className="mb-3 text-xs text-[var(--text-secondary)]">{detailStyle.description}</p>
            <div className="mb-3 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">What it changes</div>
            <ul className="mb-3 space-y-1">
              {styleComponents(detailStyle).map((c) => (
                <li key={c} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent-hex)]" />{c}
                </li>
              ))}
            </ul>
            {detailStyle.wallpaperName && (
              <p className="mb-3 text-2xs text-[var(--text-tertiary)]">Wallpaper: {detailStyle.wallpaperName}</p>
            )}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {detailStyle.collection && <span className="badge badge-accent !text-2xs">{detailStyle.collection}</span>}
              <span className="badge badge-neutral !text-2xs">{detailStyle.axis ?? detailStyle.tier}</span>
              {detailStyle.axis && <span className="badge badge-neutral !text-2xs">{detailStyle.axis} variant</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detailStyle.tags.map((t) => (<span key={t} className="badge badge-neutral !text-2xs">{t}</span>))}
            </div>
            <button
              className={`btn-ghost mt-3 w-full btn-sm ${favorites.includes(detailStyle.id) ? "!text-amber-500" : ""}`}
              onClick={() => toggleFav(detailStyle.id)}
            >
              <IconStar size={12} className={favorites.includes(detailStyle.id) ? "fill-amber-400 text-amber-400" : ""} />
              {favorites.includes(detailStyle.id) ? "Favorited — click to remove" : "Add to favorites"}
            </button>
            {/* S6.5 — every style ships as a share code (offline, deterministic) */}
            {(() => {
              const code = detailStyle ? encodeStyleCode(detailStyle) : null;
              if (!code) return null;
              return (
                <div className="mt-3">
                  <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Share code</div>
                  <div className="flex gap-1.5">
                    <input readOnly value={code} onFocus={(e) => e.target.select()} className="input flex-1 !text-xs" spellCheck={false} />
                    <button
                      className="btn-ghost btn-sm shrink-0"
                      onClick={async () => {
                        const ok = await copyText(code);
                        toast(ok ? "Share code copied to clipboard" : `Copy blocked — select the code above (${code})`, ok ? "ok" : "info");
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="mt-1 text-2xs text-[var(--text-tertiary)]">Codes are offline and deterministic — share this and anyone can import the exact look.</p>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick History — recent theme changes
// ---------------------------------------------------------------------------

function QuickHistory() {
  const [entries, setEntries] = useState<{ id: string; description: string; ts: number; kind: string }[]>([]);

  useEffect(() => {
    call<UndoEntry[]>("get_undo_log")
      .then((log) => setEntries(log.slice(0, 5).map((e) => ({ id: e.id, description: e.description, ts: e.ts, kind: e.kind }))))
      .catch((e) => swallow("get_undo_log (QuickHistory)", e));
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-3">
      <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Recent Changes</div>
      <div className="space-y-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-2xs">
            <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--text-tertiary)]" />
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={e.description}>{e.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = (i: number) => Math.min(255, Math.max(0, parseInt(h.slice(i, i + 2), 16) + amt));
  return `#${[n(0), n(2), n(4)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}


// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Wallpaper Gallery — manifest-backed, lazy, performance-safe (C1.9–C1.13)
// ---------------------------------------------------------------------------

/** Live tile: preload=none + imperative play on hover — at most one video
 *  decodes at a time, nothing loads for tiles you never hover (C1.11).
 *  On failure the video hides itself and the tile falls back to the
 *  dominant-color placeholder so a broken file never shows a black box. */
function LiveTile({ w, hovered }: { w: WallpaperEntry; hovered: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v || failed) return;
    if (hovered) v.play().catch((e) => swallow("video hover autoplay", e));
    else v.pause();
  }, [hovered, failed]);
  return (
    <>
      <video
        ref={ref}
        src={w.file}
        muted
        loop
        playsInline
        preload="none"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition-transform group-hover:scale-110 ${failed ? "hidden" : ""}`}
      />
      {!hovered && !failed && (
        <span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white">
          <IconPlay size={13} className="ml-0.5" />
        </span>
      )}
      {failed && (
        <span className="absolute inset-0 flex items-center justify-center text-2xs text-white/50">Preview unavailable</span>
      )}
    </>
  );
}

function WallpaperGallery({ onApply, onStyle }: { onApply: (path: string, type: "static" | "live") => void; onStyle: (w: WallpaperEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("All");
  const [typeFilter, setTypeFilter] = useState<"all" | "static" | "live">("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filtered = ALL_WALLPAPERS.filter((w) => {
    if (category !== "All" && w.category !== category) return false;
    if (typeFilter !== "all" && w.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border-default)]">
      {/* Collapsed-by-default header — content lazy-mounts on first expand (C1.9) */}
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <IconImage size={14} className="text-[var(--text-tertiary)]" />
          Wallpaper library
          <span className="badge badge-accent">{WALLPAPER_COUNT.total}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-2xs text-[var(--text-tertiary)]">
          {WALLPAPER_COUNT.static} static · {WALLPAPER_COUNT.live} live
          <IconChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--border-default)] p-3">
          <div className="mb-3 flex gap-1">
            {(["all", "static", "live"] as const).map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`rounded px-2 py-0.5 text-2xs transition-colors ${typeFilter === t ? "bg-[var(--accent-hex)] text-white" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>
                {t === "live" && <IconFilm size={10} className="mr-0.5" />}
                {t === "static" && <IconImage size={10} className="mr-0.5" />}
                {t}
              </button>
            ))}
          </div>

          {/* Category pills */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={`rounded-full px-3 py-1 text-2xs transition-colors ${category === c ? "bg-[var(--accent-hex)] text-white" : "bg-[var(--surface-overlay)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>
                {c}
              </button>
            ))}
          </div>

          {/* Windowed grid — only tiles near the viewport mount media (C1.10–C1.11) */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((w) => (
              <div
                key={w.id}
                role="button"
                tabIndex={0}
                onClick={() => onApply(w.file, w.type)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onApply(w.file, w.type); } }}
                onMouseEnter={() => setHoveredId(w.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="group relative aspect-video cursor-pointer overflow-hidden rounded-lg border border-[var(--border-default)] transition-all hover:border-[var(--border-accent)] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-hex)]"
                style={{ boxShadow: hoveredId === w.id ? `0 4px 20px ${w.dominantColor}44` : undefined, background: w.dominantColor }}
              >
                {w.type === "static" ? (
                  <img src={w.file} alt={w.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-110" />
                ) : (
                  <LiveTile w={w} hovered={hoveredId === w.id} />
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="px-2 pb-1.5">
                    <div className="truncate text-2xs font-medium text-white" title={w.name}>{w.name}</div>
                    <div className="flex items-center gap-1">
                      {w.type === "live" && <span className="badge badge-accent !text-2xs !py-0">LIVE</span>}
                      <span className="text-2xs text-white/60">{w.category}</span>
                    </div>
                  </div>
                </div>
                {/* Turn this wallpaper into a full style (C1.18) */}
                <button
                  onClick={(e) => { e.stopPropagation(); onStyle(w); }}
                  className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/35 text-white/85 opacity-0 transition-opacity hover:bg-[var(--accent-hex)] hover:text-white group-hover:opacity-100"
                  title="Generate a complete style from this wallpaper"
                >
                  <IconStar size={11} />
                </button>
                {/* Dominant color indicator */}
                <div className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border border-white/30 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: w.dominantColor }} />
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="empty-state">No wallpapers match this filter.</div>
          )}

          <p className="mt-3 text-2xs text-[var(--text-tertiary)]">
            {WALLPAPER_COUNT.static} static + {WALLPAPER_COUNT.live} live wallpapers bundled. Images load lazily as you scroll; videos are on-demand and play on hover.
          </p>
        </div>
      )}
    </div>
  );
}
