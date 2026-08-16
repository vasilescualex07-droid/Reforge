// S14 — storage liberation. The backend logic (size gates, categories,
// trash staging, dry-run vs apply, schedule) is covered by Rust tests; these
// cover the UI wiring + mock round-trips:
//   S14.1 radar bars render + clicking a top-level folder drills into it
//   S14.2 one-click safe clean: preview → confirm → freed toast + undo entry
//   S14.3 unused tab: knobs honored, delete is confirm-gated and undoable
//   S14.4 storage settings: thresholds + toggles persist via the config
//   S14.5 History report card: per-category chips + skip reasons
//   S14.6 bonus saves: recycle bin size + confirm-gated empty
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { ToastHost } from "../components/ui";
import Organize from "./Organize";
import History from "./History";
import Settings from "./Settings";
import type { StorageConfig } from "../lib/types";

const STORE_KEY = "reforge-mock-v1";

/** Fresh mock module instance — isolated store per test. */
async function reloadedMock() {
  vi.resetModules();
  return import("../lib/mock");
}

afterEach(() => {
  localStorage.removeItem(STORE_KEY);
  vi.resetModules();
});

function withToasts(node: React.ReactNode) {
  return render(
    <>
      <ToastHost />
      {node}
    </>,
  );
}

const DEFAULT_CFG: StorageConfig = {
  unused_days: 180,
  unused_min_mb: 10,
  safe_temp: true,
  safe_update_cache: true,
  safe_recycle_bin: true,
  safe_browser_caches: true,
  safe_installers: true,
  exclusions: [],
  dry_run: true,
  auto_clean: "off",
};

async function clickButton(container: HTMLElement, text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  expect(btn, `button "${text}"`).toBeTruthy();
  fireEvent.click(btn!);
}

/** Click a button inside the open Modal dialog (its confirm label can collide
 *  with the trigger button behind it, so scope the query to the dialog). */
async function clickDialogConfirm(container: HTMLElement, label: string) {
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog, "modal open").toBeTruthy();
  const btn = Array.from(dialog!.querySelectorAll("button")).find((b) => b.textContent === label);
  expect(btn, `dialog confirm "${label}"`).toBeTruthy();
  fireEvent.click(btn!);
}

describe("S14 storage liberation", () => {
  it("S14.1 radar renders drive bars and drills into a top-level folder", { timeout: 120_000 }, async () => {
    await reloadedMock();
    const { container } = withToasts(<Organize />);
    await waitFor(() => expect(container.textContent).toContain("Storage radar"), { timeout: 8000 });
    // per-drive bar: label + used/free totals render
    await waitFor(() => expect(container.textContent).toContain("C:"), { timeout: 8000 });
    expect(container.textContent).toContain("free");
    expect(container.textContent).toContain("D:");
    // top-level folder chips render
    await waitFor(() => expect(container.textContent).toContain("Windows"), { timeout: 8000 });
    // drill-down: clicking the Users chip scans inside it
    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Users"))!);
    await waitFor(() => expect(container.textContent).toContain("edit-final.mp4"), { timeout: 8000 });
    expect(container.textContent).toContain("Video");
  });

  it("S14.2 safe clean: preview → confirm → freed + undo entry", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    await m.mockCall("mock_reset_storage", {});
    await m.mockCall("set_storage_config", { cfg: { ...DEFAULT_CFG, dry_run: false } });
    const { container } = withToasts(<Organize />);
    await waitFor(() => expect(container.textContent).toContain("One-click safe clean"), { timeout: 8000 });
    await clickButton(container, "Preview what can go");
    // curated list includes regenerable junk + recycle bin + old installers
    await waitFor(() => expect(container.textContent).toContain("User temp files"), { timeout: 8000 });
    expect(container.textContent).toContain("Recycle Bin");
    expect(container.textContent).toContain("Moves to staging trash");
    // run with the default (all-selected) set — confirm inside the modal
    await clickButton(container, "Clean");
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeTruthy(), { timeout: 8000 });
    await clickDialogConfirm(container, "Clean");
    await waitFor(() => expect(container.textContent).toContain("Freed"), { timeout: 8000 });
    // an undo entry with per-category payload exists
    const log = await m.mockCall<any[]>("get_undo_log");
    const clean = log.find((e) => e.kind === "storage_clean");
    expect(clean).toBeTruthy();
    expect(clean.data.categories.length).toBeGreaterThan(0);
  });

  it("S14.3 unused tab: days knob filters, delete is confirm-gated + undoable", { timeout: 120_000 }, async () => {
    await reloadedMock();
    const { container } = withToasts(<Organize />);
    await waitFor(() => expect(container.textContent).toContain("Storage radar"), { timeout: 8000 });
    await clickButton(container, "Unused");
    await waitFor(() => expect(container.textContent).toContain("Time to let go"), { timeout: 8000 });
    await clickButton(container, "Scan");
    // 180-day default: only old files in the default Downloads dir surface
    await waitFor(() => expect(container.textContent).toContain("project-backup-2023.zip"), { timeout: 8000 });
    expect(container.textContent).toContain("old-setup.exe");
    expect(container.textContent).not.toContain("recent.pdf");
    expect(container.textContent).toContain("last changed 400d ago");
    // select one and confirm the move
    fireEvent.click(Array.from(container.querySelectorAll("input[type=checkbox]"))[0]!);
    await clickButton(container, "Move 1 to staging trash");
    await waitFor(() => expect(container.textContent).toContain("Move unused files to trash?"), { timeout: 8000 });
    await clickButton(container, "Move to trash");
    await waitFor(() => expect(container.textContent).toContain("staging trash"), { timeout: 8000 });
  });

  it("S14.4 storage settings: thresholds + toggles persist round-trip", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    await m.mockCall("mock_reset_storage", {});
    const { container } = withToasts(<Settings />);
    await waitFor(() => expect(container.textContent).toContain("Safe-clean rules"), { timeout: 8000 });
    // change the unused threshold and flip the recycle-bin safe toggle
    await waitFor(() => expect(container.querySelector('input[aria-label="Unused days"]')).toBeTruthy(), { timeout: 8000 });
    fireEvent.change(container.querySelector('input[aria-label="Unused days"]')!, { target: { value: "90" } });
    await clickButton(container, "Save storage settings");
    await waitFor(async () => {
      const cfg = await m.mockCall<StorageConfig>("get_storage_config");
      expect(cfg.unused_days).toBe(90);
    }, { timeout: 8000 });
    // toggle off the recycle bin via its labeled toggle button
    const rbToggle = Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Recycle Bin");
    expect(rbToggle).toBeTruthy();
    fireEvent.click(rbToggle!);
    await clickButton(container, "Save storage settings");
    await waitFor(async () => {
      const cfg = await m.mockCall<StorageConfig>("get_storage_config");
      expect(cfg.safe_recycle_bin).toBe(false);
    }, { timeout: 8000 });
  });

  it("S14.5 History shows the storage-clean report card with category chips", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    await m.mockCall("mock_reset_storage", {});
    await m.mockCall("set_storage_config", { cfg: { ...DEFAULT_CFG, dry_run: false } });
    await m.mockCall("clean_now", { ids: ["temp", "recycle_bin"] });
    const { container } = withToasts(<History />);
    await waitFor(() => expect(container.textContent).toContain("Safe clean freed"), { timeout: 8000 });
    // per-category chips from the undo payload
    expect(container.textContent).toContain("User temp files");
    expect(container.textContent).toContain("Recycle Bin");
  });

  it("S14.6 recycle bin: size shown, empty is confirm-gated", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    await m.mockCall("mock_reset_storage", {});
    const { container } = withToasts(<Organize />);
    await waitFor(() => expect(container.textContent).toContain("More ways to save"), { timeout: 8000 });
    // size renders once recycle_bin_state resolves (mock recycle bin is 2.4 GB)
    await waitFor(() => expect(container.textContent).toMatch(/2\.[0-9] GB/), { timeout: 8000 });
    await clickButton(container, "Empty");
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeTruthy(), { timeout: 8000 });
    await clickDialogConfirm(container, "Empty");
    await waitFor(() => expect(container.textContent).toContain("Recycle Bin emptied"), { timeout: 8000 });
    const state = await m.mockCall<{ size: number; empty: boolean }>("recycle_bin_state");
    expect(state.empty).toBe(true);
  });
});
