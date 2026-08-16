// S2.4 — empty-state pass verification.
// Renders Makeover (the view that owns the S2.4 gaps: imported video wallpapers,
// classic packs, widgets) with the backend mocked to return ZERO data, and
// asserts every list shows an honest empty state — never a raw "undefined" or a
// blank panel. Also renders History and Marketplace (the other S2.4-named views).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Makeover from "./Makeover";
import History from "./History";
import Marketplace from "./Marketplace";

const { callMock, callWithTimeoutMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  callWithTimeoutMock: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    call: callMock,
    callWithTimeout: callWithTimeoutMock,
    errorCopy: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    swallow: () => {},
    onEvent: () => () => {},
    // api.ts re-exports these from format.ts — views import them from api.
    fmt: actual.fmt,
    fmtAge: actual.fmtAge,
    fmtDate: actual.fmtDate,
  };
});

/** Default zero-data backend. Getters that expect an object return null; list
 *  getters return [] — every view must degrade to an honest empty state. */
function zeroDataCall(cmd: string): unknown {
  switch (cmd) {
    // Object/state getters: return null (views guard with ?./?? []).
    case "get_theme_state":
      return { mode: "dark", accent_hex: "#0067C0", transparency: "mica", taskbar: "default", widgets: "default" };
    case "get_capability_matrix":
      return { taskbar_reposition: true, widgets: true, video_wallpaper: true, rgb: false, blue_light: true, power_plans: true, lock_screen: true, display_profiles: true, accessibility: false, gaming_mode: true, sound_schemes: true };
    case "get_applied_style":
    case "get_wallpapers": // WallpaperState object (monitors/wallpapers arrays nested)
    case "get_wallpaper_engine_state":
    case "get_wallpaper_slideshow":
    case "shell_get_taskbar_state":
    case "media_get_transcode_status":
    case "get_current_scheme":
    case "get_cursor_state":
    case "get_lock_screen_state":
    case "get_system_info":
    case "get_health_score":
    case "get_build_info":
    case "scan_junk":
    case "scan_duplicates":
      return null;
    default:
      // Everything else is a list getter — the zero-data case this test exists
      // for. Returning [] lets every list view render its honest empty state.
      return [];
  }
}

beforeEach(() => {
  callMock.mockReset();
  callWithTimeoutMock.mockReset();
  callWithTimeoutMock.mockResolvedValue(null);
  callMock.mockImplementation(async (cmd: string) => zeroDataCall(cmd));
});

describe("S2.4 zero-data empty states", () => {
  it("Makeover shows empty states for video wallpapers, classic packs, and widgets — no raw undefined", async () => {
    const { container } = render(<Makeover />);
    await waitFor(
      () => expect(screen.getByText(/No imported videos yet/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByText(/No packs installed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No widgets yet/i)).toBeInTheDocument();
    // The whole view must render without a literal "undefined" leaking into text.
    expect(container.textContent).not.toContain("undefined");
  });

  it("History shows an empty state when nothing has been logged", async () => {
    render(<History />);
    await waitFor(
      () => expect(screen.getByText(/Nothing logged yet/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it("Marketplace shows an empty state when no packs are installed", async () => {
    render(<Marketplace />);
    await waitFor(
      () => expect(screen.getByText(/No packs installed yet/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});
