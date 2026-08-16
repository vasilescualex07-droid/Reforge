// S8.5 — scene → screensaver (E4.6). Makeover's Screensaver section arms the
// feature (registry write on the Rust side), picks a scene + idle timeout, and
// offers a live Preview. This test drives the section through the mock backend
// and asserts the config round-trips and the registry truth follows.
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import Makeover from "./Makeover";
import { mockCall } from "../lib/mock";
import type { ScreensaverConfig, ScreensaverRegistry } from "../lib/types";

function screensaverSection(container: HTMLElement): HTMLElement {
  const section = Array.from(container.querySelectorAll("section")).find((el) =>
    el.textContent?.includes("Screensaver"),
  );
  if (!section) throw new Error("Screensaver section not found");
  return section;
}

describe("S8.5 screensaver section", () => {
  it("renders the section with a disabled default", { timeout: 60_000 }, async () => {
    const { container } = render(<Makeover />);
    const section = screensaverSection(container);
    await waitFor(() => {
      const toggle = section.querySelector("button[role='switch']");
      expect(toggle).not.toBeNull();
      expect(toggle!.getAttribute("aria-checked")).toBe("false");
    });
    const timeout = section.querySelector<HTMLInputElement>("input[type='number']");
    expect(timeout).not.toBeNull();
    expect(timeout!.value).toBe("300");
  });

  it("arms: enable → timeout → scene → registry truth", { timeout: 60_000 }, async () => {
    const { container } = render(<Makeover />);
    const section = screensaverSection(container);
    const toggle = await waitFor(() => {
      const t = section.querySelector("button[role='switch']");
      if (!t) throw new Error("no toggle yet");
      return t;
    });

    // The mock backend answers every call after a 200ms delay — give each
    // action that window plus margin before asserting the store state.
    await act(async () => { fireEvent.click(toggle); });
    await new Promise((r) => setTimeout(r, 450));
    let cfg = await mockCall<ScreensaverConfig>("get_screensaver_config", {});
    expect(cfg.enabled).toBe(true);

    const timeoutInput = section.querySelector<HTMLInputElement>("input[type='number']");
    expect(timeoutInput).not.toBeNull();
    await act(async () => { fireEvent.change(timeoutInput!, { target: { value: "60" } }); });
    await new Promise((r) => setTimeout(r, 450));
    const select = section.querySelector<HTMLSelectElement>("select");
    expect(select).not.toBeNull();
    // Scenes load async — wait until the picker actually lists one.
    await waitFor(() => {
      expect(Array.from(select!.options).map((o) => o.value)).toContain("midnight-rain");
    });
    await act(async () => { fireEvent.change(select!, { target: { value: "midnight-rain" } }); });
    await new Promise((r) => setTimeout(r, 450));

    cfg = await mockCall<ScreensaverConfig>("get_screensaver_config", {});
    expect(cfg.enabled).toBe(true);
    expect(cfg.timeout_secs).toBe(60);
    expect(cfg.scene?.id).toBe("midnight-rain");
    const reg = await mockCall<ScreensaverRegistry>("get_screensaver_registry", {});
    expect(reg.active).toBe(true);
    expect(reg.timeout_secs).toBe(60);
  });

  it("preview button fires preview_screensaver", { timeout: 60_000 }, async () => {
    const { container } = render(<Makeover />);
    const section = screensaverSection(container);
    const preview = Array.from(section.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Preview"),
    );
    expect(preview).not.toBeNull();
    await act(async () => { fireEvent.click(preview!); });
    const msg = await mockCall<string>("preview_screensaver", {});
    expect(msg).toContain("move the mouse");
  });
});
