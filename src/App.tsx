import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { IS_TAURI, call, onEvent, swallow } from "./lib/api";
import { useI18n } from "./i18n";
import { applyThemeToDom, THEME_CHANGED_EVENT } from "./lib/theme-dom";
import { fireAction } from "./lib/events";
import { ToastHost, toast, SearchBox } from "./components/ui";
import {
  NavDashboard, NavMakeover, NavMarketplace, NavPerformance, NavTuneup,
  NavOrganize, NavSecurity, NavHistory, NavSettings, NavProductivity,
  NavDisplays, NavNetwork, NavGaming, NavPower, NavAccess, IconSearch,
  IconKeyboard, IconBell, IconStar, IconSparkles,
} from "./components/icons";
import { AchievementToastHost, WidgetsRuntime } from "./features/widgets";
import { WIZARD_KEY } from "./lib/wizardKey";
// Code-split every view so the initial bundle stays small (A3.5).
const Dashboard = lazy(() => import("./views/Dashboard"));
const MakeoverSession = lazy(() => import("./views/MakeoverSession"));
const Makeover = lazy(() => import("./views/Makeover"));
const Marketplace = lazy(() => import("./views/Marketplace"));
const Performance = lazy(() => import("./views/Performance"));
const Tuneup = lazy(() => import("./views/Tuneup"));
const Organize = lazy(() => import("./views/Organize"));
const Security = lazy(() => import("./views/Security"));
const Productivity = lazy(() => import("./views/Productivity"));
const Displays = lazy(() => import("./views/Displays"));
const Network = lazy(() => import("./views/Network"));
const Gaming = lazy(() => import("./views/Gaming"));
const History = lazy(() => import("./views/History"));
const Settings = lazy(() => import("./views/Settings"));
const Power = lazy(() => import("./views/Power"));
const Accessibility = lazy(() => import("./views/Accessibility"));
const WidgetsHub = lazy(() => import("./features/widgets/hub"));
// S10.8 wizard is code-split too: it imports the full style catalog, so it
// must never load eagerly into the shell (keeps the initial bundle small).
const FirstRunWizard = lazy(() => import("./components/Wizard"));

// Win11-style error boundary — one crashing view never blanks the app (B8).
// Error copy follows Standard B §4: say what happened + what to do, never a
// generic "Something went wrong".
class ViewBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto mt-12 max-w-md rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-6 text-center">
          <div className="text-base font-semibold text-[var(--status-danger)]">Couldn't load this section</div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{this.state.error}</p>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">You can reload it — your settings and changes are safe.</p>
          <button
            className="btn btn-primary mt-4"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Reload section
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Standard B §2 — the app boots following the OS theme + accent, and keeps
 *  following it live: get_theme_state reads the real Windows registry values,
 *  so changing your accent in Windows Settings updates Reforge within ~5s.
 *  Browser preview (no backend) follows prefers-color-scheme instead. The
 *  Theme Studio manual toggle remains the product override — it flips
 *  data-theme through the same apply path. */
function useOsThemeSync() {
  useEffect(() => {
    const apply = (t: { accent_hex: string; mode: string }) =>
      applyThemeToDom(t.accent_hex, t.mode === "light" ? "light" : "dark");
    if (IS_TAURI) {
      call<{ accent_hex: string; mode: string }>("get_theme_state")
        .then(apply)
        .catch(() => swallow("get_theme_state"));
      // Live accent-follow: re-read the registry (which reflects any manual
      // Theme Studio change) every 5s while the app runs.
      const id = window.setInterval(() => {
        call<{ accent_hex: string; mode: string }>("get_theme_state")
          .then(apply)
          .catch(() => swallow("get_theme_state poll"));
      }, 5000);
      return () => window.clearInterval(id);
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fromMq = () => applyThemeToDom("#0067c0", mq.matches ? "dark" : "light");
    fromMq();
    mq.addEventListener("change", fromMq);
    return () => mq.removeEventListener("change", fromMq);
  }, []);
}

function ViewLoader({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="space-y-4"><div className="skeleton h-9 w-64" /><div className="skeleton h-40 w-full" /><div className="skeleton h-40 w-full" /></div>}>
      {children}
    </Suspense>
  );
}

export type View = "dashboard" | "makeover" | "styles" | "marketplace" | "performance" | "tuneup" | "organize" | "security" | "history" | "settings" | "productivity" | "displays" | "network" | "gaming" | "power" | "accessibility" | "widgets";

const NAV: { id: View; label: string; icon: typeof NavDashboard; hint: string; key: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: NavDashboard, hint: "Health score & overview", key: "1" },
  { id: "makeover", label: "Makeover", icon: NavMakeover, hint: "Guided full-PC makeover", key: "2" },
  { id: "styles", label: "Style Studio", icon: IconStar, hint: "Theme studio, wallpaper engine", key: "" },
  { id: "marketplace", label: "Marketplace", icon: NavMarketplace, hint: "Install & share look packs", key: "3" },
  { id: "performance", label: "Performance", icon: NavPerformance, hint: "Live CPU / RAM / disk", key: "4" },
  { id: "tuneup", label: "Tune-up", icon: NavTuneup, hint: "Junk cleaner, startup, bloatware", key: "5" },
  { id: "organize", label: "Organize", icon: NavOrganize, hint: "Storage, auto-sort, duplicates", key: "6" },
  { id: "security", label: "Security", icon: NavSecurity, hint: "Privacy & permission audit", key: "7" },
  { id: "productivity", label: "Productivity", icon: NavProductivity, hint: "Launcher, clipboard, macros", key: "8" },
  { id: "displays", label: "Displays", icon: NavDisplays, hint: "Monitors & display profiles", key: "9" },
  { id: "network", label: "Network", icon: NavNetwork, hint: "Bandwidth, Wi-Fi, network reset", key: "0" },
  { id: "gaming", label: "Gaming", icon: NavGaming, hint: "Game mode, profiles & stream layout", key: "-" },
  { id: "power", label: "Power", icon: NavPower, hint: "Battery, plan & screen-off timers", key: "=" },
  { id: "accessibility", label: "Accessibility", icon: NavAccess, hint: "High contrast, motion, cursor, filters", key: "" },
  { id: "history", label: "History", icon: NavHistory, hint: "Timeline, undo & snapshots", key: "" },
  { id: "widgets", label: "Widgets", icon: IconSparkles, hint: "Fun overlays & achievements", key: "" },
  { id: "settings", label: "Settings", icon: NavSettings, hint: "Schedules, blue light, about", key: "/" },
];


export default function App() {
  const { t } = useI18n();
  useOsThemeSync();
  // S11.6 — a background scheduler failure (due maintenance, scheduled style)
  // must never be silent: surface it as a toast, exactly like an inline call.
  useEffect(() => {
    return onEvent<{ message: string }>("reforge-maintenance-failed", (p) => {
      if (p?.message) toast(p.message, "err");
    });
  }, []);
  // Theme Studio's manual apply announces itself so the UI updates instantly
  // (browser preview has no OS poll to catch it).
  useEffect(() => {
    const onThemeChanged = (e: Event) => {
      const d = (e as CustomEvent<{ accent_hex: string; mode: string }>).detail;
      if (d) applyThemeToDom(d.accent_hex, d.mode === "light" ? "light" : "dark");
    };
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
  }, []);
  const [view, setView] = useState<View>("dashboard");
  // S9.5 — a stats-widget row click tells the main app to open a view.
  // Tauri: the Rust `widget-nav` event; preview: the mock dispatches the same
  // payload as a `reforge:widget-nav` CustomEvent.
  useEffect(() => {
    const open = (view: unknown) => {
      if (typeof view === "string" && (NAV.some((n) => n.id === view) || view === "widgets")) {
        setView(view as View);
      }
    };
    const un = onEvent<{ view: string }>("widget-nav", (p) => open(p?.view));
    const onBrowserNav = (e: Event) => open((e as CustomEvent<{ view: string }>).detail?.view);
    window.addEventListener("reforge:widget-nav", onBrowserNav);
    return () => {
      un();
      window.removeEventListener("reforge:widget-nav", onBrowserNav);
    };
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // S1.2 — a command that the running exe doesn't know means the binary is
  // older than the frontend it ships: show a rebuild banner, never a raw
  // "command not found" toast.
  const [staleBuild, setStaleBuild] = useState(false);
  useEffect(() => {
    const onCmdNotFound = () => setStaleBuild(true);
    window.addEventListener("reforge:command-not-found", onCmdNotFound);
    return () => window.removeEventListener("reforge:command-not-found", onCmdNotFound);
  }, []);
  type Notification = { id: number; title: string; body: string; time: string; read: boolean };
  const [notifications, setNotifications] = useState<Notification[]>([
    { id: 1, title: "System scan complete", body: "No threats detected.", time: "2 min ago", read: false },
    { id: 2, title: "Junk cleanup available", body: "2.3 GB of temporary files.", time: "15 min ago", read: false },
    { id: 3, title: "Theme pack installed", body: "Midnight Rain pack ready.", time: "1 hr ago", read: true },
  ]);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

  // Welcome wizard shows exactly once, ever. The flag is persisted by the Rust
  // backend (data_dir/onboarding.json) so it survives webview origin changes;
  // localStorage is only a fallback for browser preview (no backend).
  useEffect(() => {
    let cancelled = false;
    const maybeOpen = () => {
      if (!cancelled && !localStorage.getItem(WIZARD_KEY)) setWizardOpen(true);
    };
    if (IS_TAURI) {
      call<{ wizard_seen: boolean }>("get_onboarding_state")
        .then((s) => {
          if (!cancelled && !s.wizard_seen) setWizardOpen(true);
        })
        .catch(maybeOpen);
    } else {
      maybeOpen();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        setNotifOpen(false);
      }
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        if (!isInput) { e.preventDefault(); setHelpOpen((v) => !v); }
      }
      // Number shortcuts
      if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const idx = NAV.findIndex((n) => n.key === e.key);
        if (idx >= 0) { e.preventDefault(); setView(NAV[idx].id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [paletteIdx, setPaletteIdx] = useState(0);
  type PaletteItem = { id: string; label: string; hint: string; cat: string; Icon: typeof NavDashboard };
  const paletteItems = useMemo(() => {
    const navItems: PaletteItem[] = NAV.map((n) => ({ id: n.id, label: t(`nav.${n.id}`), hint: t(`nav.${n.id}.hint`), cat: t("palette.navigation"), Icon: n.icon }));
    const extras: PaletteItem[] = [
      { id: "scan-junk", label: t("palette.scanJunk"), hint: t("palette.scanJunk.hint"), cat: t("palette.actions"), Icon: NavTuneup },
      { id: "take-snapshot", label: t("palette.takeSnapshot"), hint: t("palette.takeSnapshot.hint"), cat: t("palette.actions"), Icon: NavHistory },
      { id: "export-profile", label: t("palette.exportProfile"), hint: t("palette.exportProfile.hint"), cat: t("palette.actions"), Icon: NavSettings },
    ];
    const all = [...navItems, ...extras];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => `${i.label} ${i.hint} ${i.cat}`.toLowerCase().includes(q));
  }, [query, t]);

  useEffect(() => { setPaletteIdx(0); }, [query]);

  const runPalette = (item: PaletteItem) => {
    setPaletteOpen(false);
    setQuery("");
    switch (item.id) {
      // Real actions: navigate AND fire the event the view listens for (B5).
      case "scan-junk": setView("tuneup"); toast("Scanning for junk…", "info"); fireAction("scan-junk"); break;
      case "take-snapshot": setView("history"); toast("Taking a snapshot…", "info"); fireAction("take-snapshot"); break;
      case "export-profile": setView("settings"); toast("Exporting profile…", "info"); fireAction("export-profile"); break;
      default: setView(item.id as View);
    }
  };

  // The Wizard component owns its own state + persistence; App just toggles
  // it and reacts to completion (navigate to Makeover) / skip.
  const dismissWizard = () => setWizardOpen(false);

  const openSearch = () => {
    setPaletteOpen(true);
  };

  // S13.1 — sidebar arrow-key navigation: ArrowUp/Down move between items,
  // Home/End jump to the first/last. Roving focus, so the list stays a single
  // tab stop for keyboard users.
  const onSidebarKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-nav-item]"));
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (idx + 1) % items.length;
    else if (e.key === "ArrowUp") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next !== -1) {
      e.preventDefault();
      items[next].focus();
    }
  };

  return (
    <div className="flex h-full bg-[var(--surface-base)]">
      {/* S13.1 — skip-to-content: first tab stop, visually hidden until focused */}
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-[4px] bg-[var(--accent-hex)] px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        {t("shell.skipToContent")}
      </a>
      {/* Sidebar — Win11 Settings navigation (296px) */}
      <aside className="flex shrink-0 flex-col bg-[var(--surface-overlay)]" style={{ width: "var(--sidebar-width)" }}>
        {/* Search — "Find a setting" */}
        <div className="px-3 pb-2 pt-3">
          <button
            onClick={openSearch}
            className="flex h-9 w-full items-center gap-2 rounded-[4px] border border-[var(--border-default)] bg-[var(--surface-base)] px-3 text-sm text-[var(--text-tertiary)] transition-colors duration-100 hover:border-[#5C5C5C] hover:text-[var(--text-secondary)]"
          >
            <IconSearch size={14} />
            <span className="flex-1 text-left">{t("shell.findSetting")}</span>
          </button>
        </div>

        {/* Navigation — 44px items, 20px icons, selected #E5F3FF */}
        <nav className="flex flex-1 flex-col overflow-y-auto pb-2" onKeyDown={onSidebarKeyDown} aria-label={t("shell.mainNavigation")}>
          {NAV.map((n) => {
            const isActive = view === n.id;
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                data-nav-item
                onClick={() => setView(n.id)}
                className={`flex h-11 w-full items-center gap-3 px-4 text-left text-sm transition-colors duration-75 ${
                  isActive
                    ? "bg-[var(--surface-selected)] text-[var(--text-accent)]"
                    : "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <Icon size={20} strokeWidth={1.6} className="shrink-0" />
                <span className="min-w-0 truncate" title={t(`nav.${n.id}`)}>{t(`nav.${n.id}`)}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer — notifications & shortcuts */}
        <div className="border-t border-[var(--border-subtle)] px-2 py-2">
          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="relative flex h-11 w-full items-center gap-3 rounded-[4px] px-4 text-left text-sm text-[var(--text-primary)] transition-colors duration-75 hover:bg-[var(--surface-hover)]"
            >
              <IconBell size={20} strokeWidth={1.6} className="shrink-0" />
              <span className="flex-1 text-left">{t("shell.notifications")}</span>
              {unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--status-danger)] px-1 text-xs font-semibold text-white">
                  {unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div
                className="absolute bottom-full right-2 z-30 mb-1 w-72 rounded-[4px] border border-[var(--border-default)] bg-[var(--surface-raised)] p-1"
                style={{ boxShadow: "var(--shadow-elevation-dropdown)" }}
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Notifications</span>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-[var(--text-accent)] hover:underline">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--surface-hover)] ${!n.read ? "bg-[var(--surface-selected)]" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{n.title}</div>
                        <div className="text-xs text-[var(--text-tertiary)]">{n.body}</div>
                        <div className="mt-0.5 text-xs text-[var(--text-disabled)]">{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setHelpOpen((v) => !v)}
            className="flex h-11 w-full items-center gap-3 rounded-[4px] px-4 text-left text-sm text-[var(--text-primary)] transition-colors duration-75 hover:bg-[var(--surface-hover)]"
          >
            <IconKeyboard size={20} strokeWidth={1.6} className="shrink-0" />
            <span className="flex-1 text-left">Keyboard shortcuts</span>
          </button>
          <div className="mt-1 flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--text-tertiary)]">
            <span className={`h-1.5 w-1.5 rounded-full ${IS_TAURI ? "bg-[var(--status-success)]" : "bg-[var(--status-warning)]"}`} />
            {IS_TAURI ? "Live" : "Preview"} · Reforge v0.1.0
          </div>
        </div>
      </aside>

      {/* Main content — pure white, 40px gutters */}
      <main id="main-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-hidden outline-none">
        {staleBuild && (
          <div className="flex shrink-0 items-start gap-3 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-10 py-3">
            <div className="flex-1">
              <div className="text-sm font-semibold text-[var(--status-warning)]">This build is out of date — rebuild required</div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                The running exe doesn't know the commands this window is calling. Run <code className="font-mono">scripts/reinstall.ps1</code> (or <code className="font-mono">bash scripts/build-release.sh</code>) and relaunch Reforge.
              </div>
            </div>
            <button
              onClick={() => setStaleBuild(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="px-10 pb-16 pt-8">
            <ViewBoundary onReset={() => setView("dashboard")}>
              <div className="animate-fade-in">
                <ViewLoader>
                  {view === "dashboard" && <Dashboard onNavigate={setView} />}
                  {view === "makeover" && <MakeoverSession />}
                  {view === "styles" && <Makeover />}
                  {view === "marketplace" && <Marketplace />}
                  {view === "performance" && <Performance />}
                  {view === "tuneup" && <Tuneup />}
                  {view === "organize" && <Organize />}
                  {view === "security" && <Security />}
                  {view === "productivity" && <Productivity />}
                  {view === "displays" && <Displays />}
                  {view === "network" && <Network />}
                  {view === "gaming" && <Gaming />}
                  {view === "power" && <Power />}
                  {view === "accessibility" && <Accessibility />}
                  { view === "history" && <History /> }
                  { view === "settings" && <Settings /> }
                  { view === "widgets" && <WidgetsHub /> }
                </ViewLoader>
              </div>
            </ViewBoundary>
          </div>
        </div>
      </main>

      {/* Command palette — Win11 settings search dialog */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[6px]"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="animate-scale-in w-full max-w-xl rounded-lg bg-[var(--surface-raised)]"
            style={{ boxShadow: "var(--shadow-elevation-modal)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[var(--border-subtle)] p-4">
              <SearchBox
                autoFocus
                value={query}
                onChange={(v) => setQuery(v)}
                placeholder="Find a setting or run an action…"
              />
            </div>
            <div className="max-h-80 overflow-y-auto py-1.5">
              {paletteItems.map((item, idx) => {
                const Icon = item.Icon;
                return (
                  <button
                    key={item.id}
                    ref={idx === paletteIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                    onClick={() => runPalette(item)}
                    onMouseEnter={() => setPaletteIdx(idx)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      idx === paletteIdx ? "bg-[var(--surface-selected)]" : "hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <Icon size={18} strokeWidth={1.6} className="shrink-0 text-[var(--text-tertiary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--text-primary)]" title={item.label}>{item.label}</span>
                      <span className="block truncate text-xs text-[var(--text-tertiary)]" title={item.hint}>{item.hint}</span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--text-disabled)]">{item.cat}</span>
                  </button>
                );
              })}
              {paletteItems.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-[var(--text-tertiary)]">
                  No results for "{query}"
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-tertiary)]">
              <span>{paletteItems.length} results</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                <span className="flex items-center gap-1"><kbd>↵</kbd> select</span>
                <span className="flex items-center gap-1"><kbd>esc</kbd> close</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts overlay */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[6px]"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="animate-scale-in w-full max-w-lg rounded-lg bg-[var(--surface-raised)] p-6"
            style={{ boxShadow: "var(--shadow-elevation-modal)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">Keyboard shortcuts</h2>
              <button onClick={() => setHelpOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="space-y-1">
              {NAV.filter((n) => n.key).map((n) => (
                <div key={n.id} className="flex h-8 items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">{n.label}</span>
                  <kbd>{n.key}</kbd>
                </div>
              ))}
              <div className="my-2 h-px bg-[var(--border-subtle)]" />
              {[
                ["Ctrl+K", "Command palette"],
                ["?", "Toggle shortcuts"],
                ["Esc", "Close dialogs"],
              ].map(([key, desc]) => (
                <div key={key} className="flex h-8 items-center justify-between">
                  <span className="text-sm text-[var(--text-secondary)]">{desc}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <FirstRunWizard
          open={wizardOpen}
          onDone={() => {
            setWizardOpen(false);
            setView("makeover");
          }}
          onSkip={dismissWizard}
        />
      </Suspense>

      <ToastHost />
      {/* Widgets runtime — orchestration only, no DOM; works from any view */}
      <WidgetsRuntime />
      <AchievementToastHost />
    </div>
  );
}
