// S5.7 — grid scale test (A1.4). The Style Studio grid must stay healthy at
// 500+ styles: the count badge reflects the full catalog, the windowed grid
// renders 24 cards with ZERO media mounted on load (gradient previews only),
// hovering a card mounts exactly one ScenePreview canvas (and unhovering
// unmounts it), and switching filters keeps the exact same grid structure —
// the jsdom-provable half of "no layout shift" (real pixels = manual check).
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { STYLE_COUNT } from "../styles/index";
import Makeover from "./Makeover";

const MIN_STYLES = 500;
const WINDOW = 24;

function styleSection(container: HTMLElement): HTMLElement {
  const section = Array.from(container.querySelectorAll("section")).find((el) =>
    el.textContent?.includes("Style Studio"),
  );
  if (!section) throw new Error("Style Studio section not found");
  return section;
}

function gridCards(section: HTMLElement): HTMLElement[] {
  return Array.from(section.querySelectorAll<HTMLElement>("div[role='button']")).filter((el) =>
    el.querySelector('span[title], [class*="line-clamp"]') !== null,
  );
}

describe("S5.7 studio grid scale (500+ styles)", () => {
  it("the catalog badge reports 500+ complete looks", () => {
    expect(STYLE_COUNT.total).toBeGreaterThanOrEqual(MIN_STYLES);
    const { container } = render(<Makeover />);
    const section = styleSection(container);
    expect(section.textContent).toContain(`${STYLE_COUNT.total} complete looks`);
    expect(section.textContent).toContain(`${STYLE_COUNT.flagship} flagships`);
    expect(section.textContent).toContain(`${STYLE_COUNT.library} library variants`);
  });

  it("renders exactly 24 windowed cards with ZERO media mounted on load", async () => {
    const { container } = render(<Makeover />);
    const section = styleSection(container);
    // 0 media: the preview strip is a gradient div, never an <img>/<video>.
    expect(section.querySelectorAll("img, video")).toHaveLength(0);
    // 0 ScenePreview canvases on load — animation only starts on hover.
    expect(section.querySelectorAll("canvas")).toHaveLength(0);
    // The windowed grid caps the DOM at 24 cards no matter how big the catalog.
    const cards = gridCards(section);
    expect(cards.length).toBe(WINDOW);
    // Every card has the fixed-height preview strip (h-14) — stable geometry.
    for (const card of cards) {
      expect(card.querySelector('[class*="h-14"]'), "card preview strip").not.toBeNull();
    }
    expect(section.textContent).toContain(`Showing ${WINDOW} of ${STYLE_COUNT.total}`);
  });

  it("hovering a card mounts exactly one canvas; unhovering unmounts it", async () => {
    const { container } = render(<Makeover />);
    const section = styleSection(container);
    const cards = gridCards(section);
    expect(cards.length).toBe(WINDOW);
    const first = cards[0];
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

  it("switching tier filters keeps the same grid structure (no-layout-shift proxy)", async () => {
    const { container } = render(<Makeover />);
    const section = styleSection(container);
    const sceneFilter = Array.from(section.querySelectorAll("button")).find((b) =>
      b.textContent?.trim() === "Scenes",
    );
    if (!sceneFilter) throw new Error("Scenes tier filter not found");
    await act(async () => {
      fireEvent.click(sceneFilter);
      await new Promise((r) => setTimeout(r, 30));
    });
    const cards = gridCards(section);
    expect(cards.length).toBe(WINDOW);
    for (const card of cards) {
      expect(card.querySelector('[class*="h-14"]'), "card preview strip").not.toBeNull();
    }
    // Scenes tier has > 24 entries → the window text stays honest.
    expect(STYLE_COUNT.scene).toBeGreaterThan(WINDOW);
    expect(section.textContent).toContain(`Showing ${WINDOW} of ${STYLE_COUNT.scene}`);
  });
});
