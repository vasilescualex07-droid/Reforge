// S7.6 — media budget for the scene grid (A4.4/C3.2). The Animated Wallpaper
// Engine section renders ~48 scene tiles; before this fix every tile mounted a
// live ScenePreview canvas (48 rAF loops burning on load). Now tiles show a
// static color story until hovered — 0 canvases on load, exactly 1 on hover,
// and it unmounts on unhover.
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import Makeover from "./Makeover";

function sceneSection(container: HTMLElement): HTMLElement {
  const section = Array.from(container.querySelectorAll("section")).find((el) =>
    el.textContent?.includes("Animated Wallpaper Engine"),
  );
  if (!section) throw new Error("Animated Wallpaper Engine section not found");
  return section;
}

/** Scene tiles are the group divs holding a full-width apply button. */
function sceneTiles(section: HTMLElement): HTMLElement[] {
  return Array.from(section.querySelectorAll<HTMLElement>("div.group")).filter(
    (el) => el.querySelector("button.w-full") !== null,
  );
}

describe("S7.6 scene grid media budget", () => {
  it("mounts ZERO canvases on load", { timeout: 60_000 }, async () => {
    const { container } = render(<Makeover />);
    const section = sceneSection(container);
    await waitFor(() => expect(sceneTiles(section).length).toBeGreaterThan(10));
    expect(section.querySelectorAll("canvas")).toHaveLength(0);
    expect(section.querySelectorAll("img, video")).toHaveLength(0);
  });

  it("mounts exactly ONE canvas on hover and unmounts it on unhover", { timeout: 60_000 }, async () => {
    const { container } = render(<Makeover />);
    const section = sceneSection(container);
    await waitFor(() => expect(sceneTiles(section).length).toBeGreaterThan(10));
    const tiles = sceneTiles(section);
    const first = tiles[0];
    expect(first.querySelector("canvas")).toBeNull();
    await act(async () => {
      fireEvent.mouseEnter(first);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(first.querySelectorAll("canvas")).toHaveLength(1);
    expect(section.querySelectorAll("canvas")).toHaveLength(1);
    await act(async () => {
      fireEvent.mouseLeave(first);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(first.querySelector("canvas")).toBeNull();
    expect(section.querySelectorAll("canvas")).toHaveLength(0);
  });
});
