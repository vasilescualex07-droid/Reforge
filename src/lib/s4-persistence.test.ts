// S4.6 — reload-persistence matrix (B2/A4.1).
// The mock backend persists its whole store to localStorage (reforge-mock-v1,
// debounced 200ms, flushed on beforeunload) so the browser preview survives
// reloads. This test proves the matrix: apply style → reload → badge + History
// survive; favorites, slideshow and blue-light intensity survive too.
//
// "Reload" is simulated honestly: vi.resetModules() + a fresh dynamic import
// re-runs mock.ts's module-level loadStore(), exactly what a page reload does.
import { afterEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "reforge-mock-v1";

/** Fresh module instance — simulates a page reload (module re-evaluated, loadStore() runs). */
async function reloadedMock() {
  vi.resetModules();
  return import("./mock");
}

async function flushPersist() {
  // The mock flushes its debounced write on beforeunload — drive it directly.
  window.dispatchEvent(new Event("beforeunload"));
}

afterEach(() => {
  localStorage.removeItem(STORE_KEY);
  vi.resetModules();
});

describe("S4.6 reload-persistence matrix (mock backend)", () => {
  it("applied style + History entry survive a reload", async () => {
    const m1 = await reloadedMock();
    await m1.mockCall("apply_style", {
      style: {
        id: "wp-slate-nights",
        name: "Slate Nights",
        mode: "dark",
        accent_hex: "#6D7CFF",
        transparency: true,
        wallpaper: "wallpapers/slate-nights.jpg",
        wallpaper_type: "static",
      },
    });
    await flushPersist();
    expect(localStorage.getItem(STORE_KEY)).not.toBeNull();

    const m2 = await reloadedMock();
    // get_applied_style returns the applied style's id (the badge source).
    const applied = await m2.mockCall<string | null>("get_applied_style");
    expect(applied).toBe("wp-slate-nights");

    const log = await m2.mockCall<{ kind: string; description: string }[]>("get_undo_log");
    expect(log.some((e) => e.kind === "style_applied" && e.description.includes("Slate Nights"))).toBe(true);
  });

  it("favorites survive a reload", async () => {
    const m1 = await reloadedMock();
    await m1.mockCall("set_favorite", { id: "wp-aurora-peak", fav: true });
    await flushPersist();

    const m2 = await reloadedMock();
    const favs = await m2.mockCall<string[]>("get_favorites");
    expect(favs).toContain("wp-aurora-peak");
  });

  it("slideshow config (enabled + interval + shuffle) survives a reload", async () => {
    const m1 = await reloadedMock();
    await m1.mockCall("set_wallpaper_slideshow", {
      cfg: { enabled: true, folder: "C:\\Users\\you\\Pictures", interval_minutes: 15, shuffle: true },
    });
    await flushPersist();

    const m2 = await reloadedMock();
    const cfg = await m2.mockCall<{ enabled: boolean; interval_minutes: number; shuffle: boolean }>(
      "get_wallpaper_slideshow",
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.interval_minutes).toBe(15);
    expect(cfg.shuffle).toBe(true);
  });

  it("blue-light on/off + intensity survive a reload", async () => {
    const m1 = await reloadedMock();
    await m1.mockCall("set_blue_light", { on: true, intensity: 0.65 });
    await flushPersist();

    const m2 = await reloadedMock();
    const cfg = await m2.mockCall<{ blue_light_on: boolean; blue_light_intensity: number }>("get_automation_config");
    expect(cfg.blue_light_on).toBe(true);
    expect(cfg.blue_light_intensity).toBeCloseTo(0.65);
  });

  it("an undo entry can be reverted after a reload (undo log state persisted)", async () => {
    const m1 = await reloadedMock();
    await m1.mockCall("set_blue_light", { on: true, intensity: 0.4 });
    await flushPersist();

    const m2 = await reloadedMock();
    const log = await m2.mockCall<{ id: string; kind: string; revertible: boolean }[]>("get_undo_log");
    const entry = log.find((e) => e.kind === "blue_light" && e.revertible);
    expect(entry).toBeDefined();
    const msg = await m2.mockCall<string>("revert_entry", { id: entry!.id });
    expect(msg).toMatch(/reverted/i);
    const cfg = await m2.mockCall<{ blue_light_on: boolean }>("get_automation_config");
    expect(cfg.blue_light_on).toBe(false);
  });
});
