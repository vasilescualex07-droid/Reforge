// S3.8 (fixes K6) — duplicate-trash flow end-to-end verification.
// Path: scan duplicates -> select -> "Remove selected" moves them to staging
// trash (reversible: an undo entry is logged) -> "Empty trash" is
// confirm-gated (Modal) and permanent (non-revertible undo entry).
//
// Note on toasts: `toast()` no-ops unless ToastHost is mounted (App shell),
// so this test asserts on view state + the backend's undo log instead.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Organize from "./Organize";
import type { DuplicateScan } from "../lib/types";

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

/** A small in-memory mock of the staging-trash store, mirroring mock.ts's
 *  shape for the commands Organize actually drives. */
const backend = vi.hoisted(() => {
  const scan: DuplicateScan = {
    scanned_bytes: 0,
    total_wasted: 4_800_000,
    groups: [
      {
        id: "photo",
        name: "photo.jpg",
        size: 2_400_000,
        files: [
          { path: "C:/Users/you/Downloads/photo.jpg", modified: 0 },
          { path: "C:/Users/you/Downloads/photo (1).jpg", modified: 0 },
        ],
      },
      {
        id: "report",
        name: "report.pdf",
        size: 900_000,
        files: [
          { path: "C:/Users/you/Downloads/report.pdf", modified: 0 },
          { path: "C:/Users/you/Downloads/report (1).pdf", modified: 0 },
        ],
      },
    ],
  };
  return { scan, trashSize: 0, undo: [] as { kind: string; description: string; revertible: boolean }[] };
});

function handleCall(cmd: string, args: Record<string, unknown> = {}): unknown {
  switch (cmd) {
    case "scan_duplicates":
      return backend.scan;
    case "remove_duplicates": {
      const n = (args.paths as string[]).length;
      backend.trashSize += n * 2_400_000;
      backend.undo.unshift({
        kind: "duplicates_removed",
        description: `Moved ${n} duplicate files to staging trash`,
        revertible: true,
      });
      return `Moved ${n} files to staging trash (reversible)`;
    }
    case "trash_size":
      return backend.trashSize;
    case "empty_trash": {
      backend.trashSize = 0;
      backend.undo.unshift({
        kind: "trash_emptied",
        description: "Permanently deleted staged duplicates",
        revertible: false,
      });
      return "Emptied staging trash";
    }
    default:
      return [];
  }
}

beforeEach(() => {
  backend.trashSize = 0;
  backend.undo.length = 0;
  callMock.mockReset();
  callWithTimeoutMock.mockReset();
  callWithTimeoutMock.mockResolvedValue(null);
  callMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => handleCall(cmd, args));
});

afterEach(() => {
  cleanup();
});

describe("S3.8 duplicate-trash flow", () => {
  it("scan -> select -> remove (reversible) -> empty (confirm-gated, permanent)", async () => {
    render(<Organize />);

    // The duplicates section lives behind its own tab — open it first.
    fireEvent.click(screen.getByRole("button", { name: "Duplicates" }));

    // Scan for duplicates (the section action button is labeled "Scan").
    const scan = await screen.findByRole("button", { name: /scan/i }, { timeout: 5000 });
    fireEvent.click(scan);

    // Groups render by name with their copies.
    await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();

    // Select one group (checkbox) and remove it.
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(boxes[0]);
    const remove = screen.getByRole("button", { name: /remove selected/i });
    expect(remove.hasAttribute("disabled")).toBe(false);

    // Removing is confirm-gated.
    fireEvent.click(remove);
    const confirmModal = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(confirmModal).getByText(/remove duplicates\?/i)).toBeInTheDocument();
    fireEvent.click(within(confirmModal).getByRole("button", { name: "Remove" }));

    // Reversible: a revertible undo entry was logged with the right count
    // (only the duplicate copies — files[1..] of the selected group — move).
    await waitFor(() => {
      const e = backend.undo.find((u) => u.kind === "duplicates_removed");
      expect(e).toBeTruthy();
      expect(e!.description).toContain("1 duplicate files");
      expect(e!.revertible).toBe(true);
    }, { timeout: 5000 });

    // The results clear and the trash size is refreshed after the move.
    await waitFor(() => expect(screen.queryByText("photo.jpg")).not.toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(callMock.mock.calls.some((c) => c[0] === "trash_size")).toBe(true));

    // The staging-trash row appears with a working "Empty trash" button.
    const empty = await screen.findByRole("button", { name: /empty trash/i }, { timeout: 5000 });
    fireEvent.click(empty);
    const emptyModal = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(emptyModal).getByText(/empty staging trash\?/i)).toBeInTheDocument();
    fireEvent.click(within(emptyModal).getByRole("button", { name: "Empty trash" }));

    // Permanent: the undo entry is non-revertible and the trash size resets,
    // so the staging-trash row disappears.
    await waitFor(() => {
      const e = backend.undo.find((u) => u.kind === "trash_emptied");
      expect(e).toBeTruthy();
      expect(e!.revertible).toBe(false);
    }, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: /empty trash/i })).not.toBeInTheDocument(), {
      timeout: 5000,
    });
  });
});
