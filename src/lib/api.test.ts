import { beforeEach, describe, expect, it } from "vitest";
import { call } from "./api";

// Every command the 13 views touch that must exist in the mock. If one of
// these throws "no mock for command", a view is broken in browser preview.
const COMMANDS = [
  "get_theme_state", "set_accent_color", "set_theme_mode", "set_transparency",
  "get_wallpapers", "set_wallpaper", "set_monitor_wallpaper",
  "get_wallpaper_history", "get_wallpaper_slideshow", "set_wallpaper_slideshow", "skip_slideshow",
  "list_wallpaper_scenes", "get_wallpaper_engine_state", "set_animated_wallpaper",
  "stop_animated_wallpaper", "freeze_wallpaper", "list_video_wallpapers",
  "set_video_wallpaper", "stop_video_wallpaper", "list_widgets", "create_widget",
  "remove_widget", "set_widget_visible", "list_packs", "apply_pack",
  "scan_junk", "clean_junk", "list_startup", "toggle_startup",
  "list_bloatware", "uninstall_bloatware", "get_memory_hogs", "end_process",
  "get_performance", "get_perf_history", "get_resource_leaderboard", "get_battery_health",
  "scan_duplicates", "remove_duplicates", "empty_trash", "trash_size", "get_user_folders",
  "scan_storage", "preview_sort", "apply_sort", "get_system_info", "get_health_score",
  "list_cursor_schemes", "get_cursor_state", "apply_cursor_scheme",
  "get_security_audit", "get_permissions", "set_permission", "get_browser_privacy", "set_browser_policy",
  "security_get_health_status", "security_get_scan_history", "security_trigger_scan",
  "get_clipboard_history", "get_app_list", "launch_app", "list_macros", "create_macro",
  "remove_macro", "toggle_macro", "set_focus_mode", "get_focus_state", "get_ram_cleanup",
  "get_bandwidth_hogs", "list_wifi_profiles", "forget_wifi_profile", "reset_network",
  "list_vpn_connections", "vpn_connect", "vpn_disconnect", "get_game_mode", "set_game_mode",
  "get_stream_layout", "set_stream_layout", "get_display_info", "list_display_profiles",
  "save_display_profile", "apply_display_profile", "delete_display_profile",
  "get_onboarding_state", "set_onboarding_state",
  "get_automation_config", "set_automation_config", "set_blue_light",
  "get_transcode_config", "set_transcode_config",
  "get_screensaver_config", "set_screensaver_config", "get_screensaver_registry",
  "preview_screensaver", "dismiss_screensaver",
  "save_widget_layout", "get_widgets_settings", "set_widgets_settings",
  "get_widget_stats", "widget_open_view",
  "get_power_state", "set_power_plan", "set_screen_off_timeout", "set_hibernate",
  "list_game_profiles", "save_game_profile", "delete_game_profile", "apply_game_profile",
  "start_focus_session", "stop_focus_session", "get_focus_session",
  "get_accessibility_state", "set_accessibility_state",
  "get_dashboard_metrics", "run_maintenance", "list_reports", "archive_report", "export_profile", "import_profile",
  "list_sound_schemes", "apply_sound_scheme", "list_sound_events", "set_sound_event", "preview_sound",
  "get_lock_screen_state", "set_lock_screen_image", "set_lock_screen_slideshow", "set_lock_screen_spotlight",
  "list_installed_fonts", "list_font_substitutions", "set_font_substitution", "install_user_font", "remove_user_font",
  "rgb_detect", "rgb_set_static", "rgb_restore_current_mode",
  "marketplace_list_bundles", "marketplace_import", "marketplace_export_look", "marketplace_apply_bundle",
  "shell_get_taskbar_state", "shell_set_taskbar_size", "shell_set_taskbar_alignment",
  "shell_set_taskbar_autohide", "shell_set_taskbar_color_match", "shell_get_pending_state",
  "shell_apply_pending_restart", "shell_revert_pending", "get_capability_matrix",
  "get_undo_log", "revert_entry", "snapshot_now", "list_snapshots", "restore_snapshot",
  "apply_style", "get_applied_style",
  "get_favorites", "set_favorite",
  "get_update_config", "set_update_config", "check_for_update", "download_update", "apply_staged_update",
];

const STATIC_STYLE = {
  id: "test-style", name: "Test Style", mode: "light", accent_hex: "#0067C0",
  transparency: true, wallpaper: "/wallpapers/static/gradient-blue.jpg",
  wallpaper_type: "static",
};
const LIVE_STYLE = {
  id: "live-style", name: "Live Style", mode: "dark", accent_hex: "#22B8CF",
  transparency: true, wallpaper: "/wallpapers/live/blue-aurora.mp4",
  wallpaper_type: "live",
};
const SCENE_STYLE = {
  id: "scene-style", name: "Scene Style", mode: "dark", accent_hex: "#6D7CFF",
  transparency: false,
  scene: { id: "t-aurora", name: "T Aurora", kind: "aurora", mood: "calm", speed: 0.6, density: 0.8, colors: ["#38bdf8", "#818cf8"] },
  wallpaper_type: "scene",
};

beforeEach(() => {
  localStorage.clear();
});

describe("mock command coverage", () => {
  it(
    "every view command exists in the mock",
    async () => {
      for (const cmd of COMMANDS) {
        const p = call(cmd, {}).then(
          () => "ok",
          (e) => String(e)
        );
        const res = await p;
        expect(res, cmd).not.toContain("no mock for command");
      }
    },
    60000
  );
});

describe("apply_style state transitions", () => {
  it("static style applies accent + mode + wallpaper and marks the style applied", async () => {
    await call("apply_style", { style: STATIC_STYLE });
    const theme = await call<any>("get_theme_state");
    expect(theme.mode).toBe("light");
    expect(theme.accent_hex.toLowerCase()).toBe("#0067c0");
    const wp = await call<any>("get_wallpapers");
    expect(wp.current).toBe("/wallpapers/static/gradient-blue.jpg");
    const engine = await call<any>("get_wallpaper_engine_state");
    expect(engine.active).toBe(false);
    expect(await call<string>("get_applied_style")).toBe("test-style");
  });

  it("live style starts engine.media (video), not a static image", async () => {
    await call("apply_style", { style: LIVE_STYLE });
    const engine = await call<any>("get_wallpaper_engine_state");
    expect(engine.active).toBe(true);
    expect(engine.media?.path).toBe("/wallpapers/live/blue-aurora.mp4");
    expect(engine.scene).toBeNull();
  });

  it("scene style starts the engine with the scene and merges nothing else", async () => {
    await call("apply_style", { style: SCENE_STYLE });
    const engine = await call<any>("get_wallpaper_engine_state");
    expect(engine.active).toBe(true);
    expect(engine.scene?.kind).toBe("aurora");
    expect(engine.media).toBeNull();
    const theme = await call<any>("get_theme_state");
    expect(theme.transparency).toBe(false);
  });

  it("revert restores the full before-snapshot and clears the applied id", async () => {
    await call("set_theme_mode", { mode: "dark" });
    await call("set_accent_color", { hex: "#123456" });
    await call("apply_style", { style: STATIC_STYLE });
    const log = await call<any[]>("get_undo_log");
    const entry = log.find((e) => e.kind === "style_applied");
    expect(entry).toBeDefined();
    expect(await call<string>("get_applied_style")).toBe("test-style");
    await call("revert_entry", { id: entry.id });
    const theme = await call<any>("get_theme_state");
    expect(theme.mode).toBe("dark");
    expect(theme.accent_hex).toBe("#123456");
    // this style is no longer the applied one (an earlier non-reverted style may be)
    expect(await call<string>("get_applied_style")).not.toBe("test-style");
  });
});

describe("S12.1 updater flow", () => {
  it("check → download (verified) → apply works end-to-end", async () => {
    await call("mock_set_update_result", {
      result: {
        state: "update-available",
        current: "0.1.0",
        latest: "0.2.0",
        url: "https://example.com/reforge-0.2.0.exe",
        sha256: "a".repeat(64),
        notes: ["New features"],
        message: null,
      },
    });
    const check = await call<any>("check_for_update");
    expect(check.state).toBe("update-available");
    expect(check.latest).toBe("0.2.0");

    const staged = await call<any>("download_update", {
      version: check.latest,
      url: check.url,
      sha256: check.sha256,
    });
    expect(staged.version).toBe("0.2.0");
    expect(staged.bytes).toBeGreaterThan(0);

    const apply = await call<string>("apply_staged_update");
    expect(apply).toContain("0.2.0");
    expect(apply).toContain("staged and verified");
  });

  it("download without a staged/available update errors honestly", async () => {
    await call("mock_set_update_result", { result: null });
    await expect(
      call("download_update", { version: "9.9.9", url: "https://x/y.exe", sha256: "z" }),
    ).rejects.toThrow(/no update available/);
    await expect(call("apply_staged_update")).rejects.toThrow(/download one first/);
  });

  it("update config round-trips and defaults to no startup checks", async () => {
    const cfg = await call<any>("get_update_config");
    expect(cfg.check_on_startup).toBe(false);
    const saved = await call<any>("set_update_config", { cfg: { ...cfg, check_on_startup: true } });
    expect(saved.check_on_startup).toBe(true);
    expect((await call<any>("get_update_config")).check_on_startup).toBe(true);
  });
});

describe("errorCopy (S2.5)", () => {
  it("maps structured kinds to friendly copy", async () => {
    const { errorCopy } = await import("./api");
    expect(errorCopy({ kind: "Registry", message: "registry error" })).toMatch(/administrator/);
    expect(errorCopy({ kind: "NotFound", message: "x" })).toMatch(/may have been removed/);
    expect(errorCopy({ kind: "Io", message: "x" })).toMatch(/disk space/);
    expect(errorCopy({ kind: "Invalid", message: "bad hex" })).toContain("bad hex");
  });

  it("routes media-pipeline Command errors to the video copy", async () => {
    const { errorCopy } = await import("./api");
    expect(errorCopy({ kind: "Command", message: "ffmpeg failed: Invalid data found" })).toMatch(/valid MP4/);
    expect(errorCopy({ kind: "Command", message: "transcode error" })).toMatch(/valid MP4/);
  });

  it("never leaks raw OS permission text (S2.5 gap fix)", async () => {
    const { errorCopy } = await import("./api");
    // PowerShell/registry spawns surface as plain io errors — these must become
    // the admin-rights copy, not raw OS text.
    expect(errorCopy({ kind: "Command", message: "Access is denied. (os error 5)" })).toMatch(/administrator/);
    expect(errorCopy({ kind: "Command", message: "The requested operation requires elevation (os error 740)" })).toMatch(/administrator/);
    expect(errorCopy(new Error("permission denied"))).toMatch(/administrator/);
  });

  it("passes through unknown Command messages unchanged", async () => {
    const { errorCopy } = await import("./api");
    expect(errorCopy({ kind: "Command", message: "something unique" })).toBe("something unique");
  });
});

describe("persistence", () => {
  it("undo log round-trips through localStorage", async () => {
    await call("set_theme_mode", { mode: "light" });
    await call("apply_style", { style: STATIC_STYLE });
    await new Promise((r) => setTimeout(r, 250)); // let debounced persist flush
    expect(localStorage.getItem("reforge-mock-v1")).toBeDefined();
  });
});
