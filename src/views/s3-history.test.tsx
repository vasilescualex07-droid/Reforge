// S3.12 (A8) — History depth verification.
// Filters (kind / search / only-reversible) + select-mode batch revert with a
// single confirm, each reverting through the real revert_entry path.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import History from "./History";
import type { UndoEntry } from "../lib/types";

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

/** A small in-memory undo log mirroring the real backend's shape. */
const backend = vi.hoisted(() => {
  let seq = 0;
  const entries = (): UndoEntry[] => [
    { id: "e1", ts: Date.now() - 3600_000, kind: "accent", description: "Accent color → #0067C0", revertible: true, undone: false, data: {} },
    { id: "e2", ts: Date.now() - 3600_000, kind: "wallpaper", description: "Wallpaper → Midnight Rain", revertible: true, undone: false, data: {} },
    { id: "e3", ts: Date.now() - 3600_000, kind: "startup_disable", description: "Disabled Spotify at startup", revertible: true, undone: false, data: {} },
    { id: "e4", ts: Date.now() - 7200_000, kind: "mode", description: "Theme mode → dark", revertible: false, undone: false, data: {} },
    { id: "e5", ts: Date.now() - 7200_000, kind: "wallpaper", description: "Wallpaper → Ashes", revertible: true, undone: true, data: {} },
  ];
  return {
    entries,
    reverted: [] as string[],
    reset() {
      this.reverted.length = 0;
      seq = 0;
    },
    seq: () => seq++,
  };
});

beforeEach(() => {
  backend.reset();
  callMock.mockReset();
  callWithTimeoutMock.mockReset();
  callWithTimeoutMock.mockResolvedValue(null);
  callMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "get_undo_log":
        return backend.entries();
      case "list_snapshots":
        return [];
      case "revert_entry": {
        backend.reverted.push(args.id as string);
        return `Reverted: ${args.id}`;
      }
      case "snapshot_now":
        return { id: "snap", ts: Date.now(), state: {} };
      default:
        return null;
    }
  });
});

afterEach(() => {
  cleanup();
});

describe("S3.12 History depth", () => {
  it("renders the full timeline with all entries", async () => {
    render(<History />);
    await waitFor(() => expect(screen.getByText("Accent color → #0067C0")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("Wallpaper → Midnight Rain")).toBeInTheDocument();
    expect(screen.getByText("Disabled Spotify at startup")).toBeInTheDocument();
    expect(screen.getByText("Theme mode → dark")).toBeInTheDocument();
  });

  it("filters by kind", async () => {
    render(<History />);
    await waitFor(() => expect(screen.getByText("Accent color → #0067C0")).toBeInTheDocument(), { timeout: 5000 });

    // open the kind dropdown and pick "wallpaper"
    fireEvent.click(screen.getByRole("button", { name: "Filter by change kind" }));
    fireEvent.click(await screen.findByRole("option", { name: "wallpaper" }));

    expect(screen.getByText("Wallpaper → Midnight Rain")).toBeInTheDocument();
    expect(screen.getByText("Wallpaper → Ashes")).toBeInTheDocument();
    expect(screen.queryByText("Accent color → #0067C0")).not.toBeInTheDocument();
    expect(screen.queryByText("Disabled Spotify at startup")).not.toBeInTheDocument();
  });

  it("searches descriptions", async () => {
    render(<History />);
    await waitFor(() => expect(screen.getByText("Accent color → #0067C0")).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.change(screen.getByRole("textbox", { name: "Search history descriptions" }), {
      target: { value: "spotify" },
    });

    expect(screen.getByText("Disabled Spotify at startup")).toBeInTheDocument();
    expect(screen.queryByText("Accent color → #0067C0")).not.toBeInTheDocument();
  });

  it("toggles only-reversible", async () => {
    render(<History />);
    await waitFor(() => expect(screen.getByText("Accent color → #0067C0")).toBeInTheDocument(), { timeout: 5000 });

    // "Theme mode → dark" is info-only (not revertible) — hidden by the toggle
    fireEvent.click(screen.getByRole("switch", { name: "Only show reversible changes" }));
    expect(screen.queryByText("Theme mode → dark")).not.toBeInTheDocument();
    expect(screen.getByText("Accent color → #0067C0")).toBeInTheDocument();
  });

  it("batch-reverts selected entries with one confirm", async () => {
    render(<History />);
    await waitFor(() => expect(screen.getByText("Accent color → #0067C0")).toBeInTheDocument(), { timeout: 5000 });

    // enter select mode
    fireEvent.click(screen.getByRole("button", { name: /select to batch revert/i }));
    const boxes = screen.getAllByRole("checkbox");
    // all 5 rows render a checkbox; e4 (info-only) and e5 (already undone)
    // are disabled, leaving 3 selectable
    expect(boxes.length).toBe(5);
    const disabled = boxes.filter((b) => (b as HTMLInputElement).disabled);
    expect(disabled.length).toBe(2);

    // select two revertible entries
    fireEvent.click(boxes[0]); // e1 accent
    fireEvent.click(boxes[1]); // e2 wallpaper
    const revertBtn = screen.getByRole("button", { name: /revert 2 selected/i });
    fireEvent.click(revertBtn);

    // one confirm modal for the whole batch
    const modal = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(modal).getByText(/revert 2 selected changes\?/i)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "Revert all" }));

    // both went through revert_entry, and the selection cleared
    await waitFor(() => expect(backend.reverted.sort()).toEqual(["e1", "e2"]), { timeout: 5000 });
    expect(screen.queryByRole("button", { name: /revert 2 selected/i })).not.toBeInTheDocument();
  });
});
