// S7.2 — Makeover mount fan-out (K10/A4.1). Before this fix the view fired
// ~20 backend commands the instant it mounted. Now only the first-paint and
// studio-critical loads are eager; cursor/sounds/fonts/lock-screen/engine/
// widgets/video/taskbar sections fetch when their section first scrolls into
// view. This test overrides the global IntersectionObserver stub with one that
// NEVER fires, so lazy sections stay unloaded — and asserts the mount fires
// ≤ 10 commands (target: −50% of ~20).
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import * as api from "../lib/api";
import Makeover from "./Makeover";

class NeverIntersects implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const ORIGINAL_IO = globalThis.IntersectionObserver;

afterEach(() => {
  vi.stubGlobal("IntersectionObserver", ORIGINAL_IO);
  vi.restoreAllMocks();
});

describe("S7.2 Makeover mount fan-out", () => {
  it("mounts ≤ 10 backend commands (was ~20); lazy sections fetch on demand", { timeout: 60_000 }, async () => {
    vi.stubGlobal("IntersectionObserver", NeverIntersects);
    const spy = vi.spyOn(api, "call");
    render(<Makeover />);
    // Let the eager loads settle (mock latency ~200ms each, parallel).
    await new Promise((r) => setTimeout(r, 2500));
    const cmds = spy.mock.calls.map((c) => c[0] as string);
    const eager = [
      "get_theme_state",
      "get_wallpapers",
      "list_packs",
      "get_applied_style",
      "list_wallpaper_scenes",
      "get_wallpaper_slideshow",
      "get_wallpaper_history",
      "get_capability_matrix",
      "get_favorites", // studio favorite buttons
      "get_undo_log", // Quick History strip
    ];
    // Every eager command fired exactly once, nothing else on mount.
    expect(new Set(cmds)).toEqual(new Set(eager));
    // 10 eager (was ~20) = the −50% target.
    expect(cmds.length).toBeLessThanOrEqual(10);
    // The lazy commands were NOT called on mount.
    const lazy = ["list_cursor_schemes", "get_cursor_state", "get_wallpaper_engine_state", "list_widgets", "list_video_wallpapers", "media_get_transcode_status", "shell_get_taskbar_state", "shell_get_pending_state", "list_sound_schemes", "list_sound_events", "list_font_substitutions", "list_installed_fonts", "get_lock_screen_state"];
    for (const c of lazy) expect(cmds, `lazy command ${c} fired on mount`).not.toContain(c);
  });
});
