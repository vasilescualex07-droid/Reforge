// S3.5 + S3.10 — capability-gated honesty verification.
// S3.10: every capability_matrix false path must render a disabled/explainer
//        state, never a live-looking control. Verify: mock capability matrix
//        toggles -> the UI responds.
// S3.5:  the Settings capability row never claims "supported" without a
//        working control, and RGB UI only offers real controls when a device
//        is actually detected.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Makeover from "./Makeover";
import Settings from "./Settings";

const callMock = vi.hoisted(() => vi.fn());
const callWithTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    call: callMock,
    callWithTimeout: callWithTimeoutMock,
    IS_TAURI: false,
    errorCopy: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    swallow: () => {},
    onEvent: () => () => {},
    resolveWallpaperPath: async (p: string) => p,
    fmt: actual.fmt,
    fmtAge: actual.fmtAge,
    fmtDate: actual.fmtDate,
  };
});

/** A Win11-like machine: no taskbar reposition, no RGB, no boot customization. */
const RESTRICTED = {
  os_name: "Microsoft Windows 11 Pro",
  build: 26200,
  version_band: "win11_24h2",
  is_win11: true,
  admin: true,
  secure_boot: true,
  taskbar_reposition_supported: false,
  font_substitution_supported: true,
  lockscreen_policy_supported: true,
  boot_customization_supported: false,
  rgb_supported: false,
  video_wallpaper_supported: true,
  ffmpeg_available: true,
  elevation_required_reason: null,
};

const PERMISSIVE = { ...RESTRICTED, taskbar_reposition_supported: true, rgb_supported: true };

function baseCall(cmd: string): unknown {
  switch (cmd) {
    case "get_capability_matrix":
      return null; // replaced per-test via callMock.mockImplementation
    case "get_theme_state":
      return { mode: "dark", accent_hex: "#0067C0", transparency: "mica", taskbar: "default", widgets: "default" };
    case "get_applied_style":
    case "get_wallpapers":
    case "get_wallpaper_engine_state":
    case "get_wallpaper_slideshow":
    case "shell_get_taskbar_state":
    case "media_get_transcode_status":
    case "get_system_info":
      return null;
    default:
      return [];
  }
}

beforeEach(() => {
  callMock.mockReset();
  callWithTimeoutMock.mockReset();
  callWithTimeoutMock.mockResolvedValue(null);
  callMock.mockImplementation(async (cmd: string) => baseCall(cmd));
});

afterEach(() => {
  cleanup();
});

describe("S3.10 capability-gated controls", () => {
  // Makeover mounts every capability section — give the full-render wait a
  // realistic window under parallel load on slow machines.
  it("Win11 (no taskbar reposition): Position shows a disabled explainer, not a live control", { timeout: 15000 }, async () => {
    callMock.mockImplementation(async (cmd: string) =>
      cmd === "get_capability_matrix" ? RESTRICTED : baseCall(cmd),
    );
    render(<Makeover />);
    await waitFor(() => expect(screen.queryByText(/Windows 10 only/)).toBeInTheDocument(), { timeout: 15000 });
    // The disabled explainer is visible…
    expect(screen.getByText(/not available on this Windows version/i)).toBeInTheDocument();
    // …and its segment buttons are truly disabled (not live-looking).
    // The disabled segment is marked aria-disabled — scope the assertion to
    // it (other sections have their own live segment buttons with
    // overlapping labels like "left").
    const segment = document.querySelector('[aria-disabled="true"].segment') as HTMLElement;
    expect(segment).toBeTruthy();
    const buttons = Array.from(segment.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.hasAttribute("disabled")).toBe(true);
  });

  it("Win10 (taskbar reposition): Position buttons are live and fire the setter", { timeout: 15000 }, async () => {
    callMock.mockImplementation(async (cmd: string) =>
      cmd === "get_capability_matrix" ? PERMISSIVE : baseCall(cmd),
    );
    render(<Makeover />);
    await waitFor(() => expect(screen.getByText("Position")).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.queryByText(/not available on this Windows version/i)).not.toBeInTheDocument();
    const bottom = screen.getByRole("button", { name: "bottom" });
    expect(bottom.hasAttribute("disabled")).toBe(false);
    fireEvent.click(bottom);
    await waitFor(() =>
      expect(callMock.mock.calls.some((c) => c[0] === "shell_set_taskbar_position")).toBe(true),
    );
  });

  it("no RGB support: capability row says No and no device controls appear", async () => {
    callMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_capability_matrix") return RESTRICTED;
      if (cmd === "rgb_detect") return { available: false, devices: [], note: "No RGB devices detected" };
      return baseCall(cmd);
    });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("RGB support")).toBeInTheDocument(), { timeout: 5000 });
    // Capability row is honest about lack of support…
    expect(screen.getByText("RGB support").parentElement!.textContent).toContain("No");
    // …and the RGB section shows detection status, not dead device controls.
    expect(screen.queryByText("Static color")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("RGB supported + device detected: real controls appear", async () => {
    callMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_capability_matrix") return PERMISSIVE;
      if (cmd === "rgb_detect")
        return { available: true, devices: [{ index: 0, name: "OpenRGB Test Device" }], note: null };
      return baseCall(cmd);
    });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText(/Test Device/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("Static color")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply" });
    fireEvent.click(apply);
    await waitFor(() =>
      expect(callMock.mock.calls.some((c) => c[0] === "rgb_set_static")).toBe(true),
    );
  });
});
