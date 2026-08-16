// S10 — capability views. Drives Power, Accessibility, Gaming profiles and
// Focus sessions through the mock backend, asserting real command round-trips.
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import Power from "./Power";
import Accessibility from "./Accessibility";
import Gaming from "./Gaming";
import Productivity from "./Productivity";
import { mockCall } from "../lib/mock";
import type {
  AccessibilityState,
  FocusSession,
  GameProfile,
  PowerState,
} from "../lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("S10.1 Power view", () => {
  it("renders battery + plans and switching a plan round-trips", { timeout: 60_000 }, async () => {
    const { container } = render(<Power />);
    await waitFor(() => {
      expect(container.textContent).toContain("Battery");
      expect(container.textContent).toContain("Balanced");
    });
    const state = await mockCall<PowerState>("get_power_state", {});
    expect(state.battery?.percent).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Best performance"))!);
    });
    await sleep(500);
    const after = await mockCall<PowerState>("get_power_state", {});
    expect(after.plans.find((p) => p.active)?.name).toBe("Best performance");
  });
});

describe("S10.7 Accessibility view", () => {
  it("toggles high contrast through the mock", { timeout: 60_000 }, async () => {
    const { container } = render(<Accessibility />);
    await waitFor(() => expect(container.textContent).toContain("High contrast"));
    const toggle = Array.from(container.querySelectorAll("button[role='switch']")).find((b) =>
      b.parentElement?.firstElementChild?.textContent?.includes("High contrast"),
    )!;
    await act(async () => { fireEvent.click(toggle); });
    await sleep(500);
    const s = await mockCall<AccessibilityState>("get_accessibility_state", {});
    expect(s.high_contrast).toBe(true);
  });

  it("color filter presets round-trip", { timeout: 60_000 }, async () => {
    const { container } = render(<Accessibility />);
    await waitFor(() => expect(container.textContent).toContain("Color filter"));
    const onToggle = Array.from(container.querySelectorAll("button[role='switch']")).find((b) =>
      b.parentElement?.firstElementChild?.textContent?.includes("Color filter"),
    )!;
    await act(async () => { fireEvent.click(onToggle); });
    await sleep(450);
    const grayscale = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Grayscale")!;
    await act(async () => { fireEvent.click(grayscale); });
    await sleep(450);
    const s = await mockCall<AccessibilityState>("get_accessibility_state", {});
    expect(s.color_filter.active).toBe(true);
    expect(s.color_filter.filter_type).toBe(0);
  });
});

describe("S10.3 gaming profiles", () => {
  it("saves, lists, applies and deletes a profile", { timeout: 60_000 }, async () => {
    const { container } = render(<Gaming />);
    await waitFor(() => expect(container.textContent).toContain("Game profiles"));
    const exeInput = container.querySelector<HTMLInputElement>("input[placeholder='eldenring.exe']")!;
    await act(async () => { fireEvent.change(exeInput, { target: { value: "cyberpunk2077.exe" } }); });
    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add profile"))!);
    });
    await sleep(500);
    let profiles = await mockCall<GameProfile[]>("list_game_profiles", {});
    expect(profiles.some((p) => p.exe === "cyberpunk2077.exe")).toBe(true);

    // apply now → undo entry logged
    const apply = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Apply now"))!;
    await act(async () => { fireEvent.click(apply); });
    await sleep(450);
    const msg = await mockCall<string>("apply_game_profile", { profile: profiles[0] });
    expect(msg).toContain("applied");

    // delete
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLElement>("button[title='Delete profile']")!);
    });
    await sleep(450);
    profiles = await mockCall<GameProfile[]>("list_game_profiles", {});
    expect(profiles.some((p) => p.exe === "cyberpunk2077.exe")).toBe(false);
  });
});

describe("S10.6 focus sessions", () => {
  it("starts and stops a session through the mock", { timeout: 60_000 }, async () => {
    const { container } = render(<Productivity />);
    await waitFor(() => expect(container.textContent).toContain("Focus session"));
    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "45 min")!);
    });
    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Start"))!);
    });
    await sleep(500);
    let s = await mockCall<FocusSession>("get_focus_session", {});
    expect(s.active).toBe(true);
    expect(s.minutes).toBe(45);

    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("End session"))!);
    });
    await sleep(500);
    s = await mockCall<FocusSession>("get_focus_session", {});
    expect(s.active).toBe(false);
  });
});
