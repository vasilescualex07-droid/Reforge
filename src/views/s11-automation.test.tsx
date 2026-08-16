// S11 — automation & scheduling: blue-light schedule (time-based with a
// 10-min ramp), scheduled style applies, maintenance report cards in History,
// smart slideshow (favorites / day-night / skip), and the maintenance
// dashboard. The backend rotation/schedule logic (fake-clock, weighted picks,
// first-run grace) is covered by Rust tests; these cover the UI wiring +
// mock round-trips.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { ToastHost } from "../components/ui";
import History from "./History";
import Settings from "./Settings";

const STORE_KEY = "reforge-mock-v1";

/** Fresh mock module instance — isolated store per test (the module-level
 *  store would otherwise leak state between tests in this file). */
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

/** Real "automation config loaded" signal: the weekly-junk toggle only shows
 *  aria-checked=true once useLoad resolved (its pre-load fallback is false).
 *  Waiting for it keeps a fast patch from racing the initial load. */
async function waitForAutomationLoaded(container: HTMLElement) {
  await waitFor(() => {
    const t = container.querySelector('button[aria-label="Weekly junk cleanup"]');
    expect(t?.getAttribute("aria-checked")).toBe("true");
  }, { timeout: 8000 });
}

describe("S11 automation & scheduling", () => {
  it("S11.1 blue-light schedule: toggle + times persist, manual toggle defers to the schedule", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    const { container } = withToasts(<Settings />);
    await waitFor(() => expect(container.textContent).toContain("Blue light schedule"), { timeout: 8000 });
    // wait until the automation config has actually loaded so a patch never
    // races the initial load
    await waitForAutomationLoaded(container);

    // schedule off by default → the manual toggle owns the ramp
    expect((container.querySelector('button[aria-label="Blue light filter"]') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(container.querySelector('button[aria-label="Blue light schedule"]')!);

    // enabling shows the time pickers and disables the manual toggle
    await waitFor(
      () => expect(container.querySelector('input[aria-label="Blue light start time"]')).toBeTruthy(),
      { timeout: 8000 },
    );
    expect((container.querySelector('button[aria-label="Blue light filter"]') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(container.querySelector('input[aria-label="Blue light start time"]')!, { target: { value: "20:15" } });
    fireEvent.change(container.querySelector('input[aria-label="Blue light end time"]')!, { target: { value: "08:00" } });

    await waitFor(async () => {
      const cfg = await m.mockCall<{ blue_light_schedule: boolean; blue_light_start: string; blue_light_end: string }>("get_automation_config");
      expect(cfg.blue_light_schedule).toBe(true);
      expect(cfg.blue_light_start).toBe("20:15");
      expect(cfg.blue_light_end).toBe("08:00");
    }, { timeout: 8000 });
  });

  it("S11.3 scheduled styles: add persists the full payload, remove deletes", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    const { container } = withToasts(<Settings />);
    await waitFor(() => expect(container.textContent).toContain("Scheduled styles"), { timeout: 8000 });
    await waitForAutomationLoaded(container);

    fireEvent.change(container.querySelector('select[aria-label="Style to schedule"]')!, { target: { value: "midnight-rain" } });
    fireEvent.change(container.querySelector('input[aria-label="Scheduled style time"]')!, { target: { value: "18:30" } });
    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Schedule"))!);

    await waitFor(() => expect(container.textContent).toContain("Midnight Rain"), { timeout: 8000 });
    await waitFor(async () => {
      const cfg = await m.mockCall<{ style_schedule: { style_id: string; time: string; name: string; payload: { name: string; wallpaper_type: string } }[] }>("get_automation_config");
      expect(cfg.style_schedule.length).toBe(1);
      expect(cfg.style_schedule[0].style_id).toBe("midnight-rain");
      expect(cfg.style_schedule[0].time).toBe("18:30");
      expect(cfg.style_schedule[0].payload.name).toBe("Midnight Rain");
      // midnight-rain is a scene style — the payload carries its scene
      expect(cfg.style_schedule[0].payload.wallpaper_type).toBe("scene");
    }, { timeout: 8000 });

    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Remove"))!);
    await waitFor(async () => {
      const cfg = await m.mockCall<{ style_schedule: unknown[] }>("get_automation_config");
      expect(cfg.style_schedule.length).toBe(0);
    }, { timeout: 8000 });
  });

  it("S11.4 maintenance report cards: generate → view → archive", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    const { container } = withToasts(<History />);
    await waitFor(() => expect(container.textContent).toContain("Maintenance reports"), { timeout: 8000 });
    expect(container.textContent).toContain("No maintenance reports yet");

    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Run maintenance"))!);

    // wait for the report CARD (not the toast — "11.2 GB junk" appears in both)
    await waitFor(() => expect(container.textContent).toContain("11.2 GB junk (8 areas)"), { timeout: 8000 });
    expect(container.textContent).toContain("3.4 GB duplicates (3 groups)");
    expect(container.textContent).toContain("2 heavy startup entries");

    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Archive"))!);
    await waitFor(() => expect(container.textContent).toContain("No maintenance reports yet"), { timeout: 8000 });
    const reports = await m.mockCall<unknown[]>("list_reports");
    expect(reports.length).toBe(0);
  });

  it("S11.5 smart slideshow mock round-trip: favorites + day-night persist, skip advances, honest errors", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    await m.mockCall("set_wallpaper_slideshow", {
      cfg: {
        enabled: true,
        folder: "C:\\Users\\you\\Pictures\\Wallpapers",
        interval_minutes: 10,
        shuffle: true,
        next_rotation_ts: null,
        last_applied: null,
        favorites: [],
        day_night_filter: true,
      },
    });
    const cfg = await m.mockCall<{ day_night_filter: boolean }>("get_wallpaper_slideshow");
    expect(cfg.day_night_filter).toBe(true);

    const msg = await m.mockCall<string>("skip_slideshow");
    expect(msg).toContain("Skipped to");

    // disabling the slideshow makes skip fail honestly, never silently
    await m.mockCall("set_wallpaper_slideshow", { cfg: { ...cfg, enabled: false } });
    await expect(m.mockCall("skip_slideshow")).rejects.toThrow(/not enabled/);
  });

  it("S11.6 maintenance dashboard: fresh config shows Never run + a next-run countdown", { timeout: 120_000 }, async () => {
    const { container } = withToasts(<Settings />);
    await waitFor(() => expect(container.textContent).toContain("Weekly junk cleanup"), { timeout: 8000 });
    await waitForAutomationLoaded(container);
    // fresh config (last run 0, created_at 0 in preview): honest "Never run"
    // + "next run unknown" (the backend stamps created_at on first boot).
    expect(container.textContent).toContain("Never run");
    expect(container.textContent).toContain("next run unknown");
    expect(container.textContent).toContain("Run due maintenance now");
  });
});
