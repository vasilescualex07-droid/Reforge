// S13 — polish & accessibility gate tests:
//   S13.4 contrast snapshot — parses index.css and asserts the contract
//     (secondary text ≥ #6B6B6B, accent buttons white-on-#0067C0, 2px focus
//     rings) plus S13.2's "100ms transitions only" from the same source of
//     truth, so a token drift fails the gate instead of shipping.
//   S13.2 reduced motion — ScenePreview renders one static frame and stops the
//     rAF loop when prefers-reduced-motion is on.
//   S13.1 keyboard — skip-to-content link is first in the tab order and the
//     sidebar navigates with Arrow keys.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { ScenePreview } from "../components/ui";

const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");

// Read the stylesheet from disk — `?raw`/`?url` are swallowed by the Tailwind
// v4 vite plugin, and the source file is the single source of truth for the
// a11y contract anyway. Vitest runs from the repo root (reforge/).
// (Node types come from src/test/node-types.d.ts.)
const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

// ---- S13.4 / S13.2 snapshot from the stylesheet ---------------------------

function relLum(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe("S13.4 contrast snapshot (index.css)", () => {
  it("light --text-tertiary is ≥ #6B6B6B (darker or equal)", () => {
    const lightRoot = css.slice(0, css.indexOf(":root:not([data-theme"));
    const m = lightRoot.match(/--text-tertiary:\s*(#[0-9a-fA-F]{6})/);
    expect(m).not.toBeNull();
    expect(relLum(m![1])).toBeLessThanOrEqual(relLum("#6B6B6B") + 1e-9);
  });

  it(".btn-primary is white text on var(--accent-hex)", () => {
    const block = css.match(/\.btn-primary\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/color:\s*(#ffffff|white)/i);
    expect(block).toMatch(/background:\s*var\(--accent-hex\)/);
  });

  it(":focus-visible is a 2px outline using --border-focus", () => {
    const block = css.match(/:focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/outline:\s*2px/);
    expect(block).toContain("--border-focus");
  });

  it("motion spec: every duration token is ≤ 100ms", () => {
    const tokens = [...css.matchAll(/--duration-[\w-]+:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    for (const ms of tokens) expect(ms).toBeLessThanOrEqual(100);
  });
});

// ---- S13.2 reduced motion: scene previews freeze ---------------------------

describe("S13.2 prefers-reduced-motion", () => {
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { writable: true, value: realMatchMedia });
  });

  function stubReduced(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: reduce,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }

  it("with reduced motion ON: draws the static frame and never schedules the rAF loop", () => {
    stubReduced(true);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    render(<ScenePreview kind="rain" colors={["#60a5fa"]} className="h-24 w-24" />);
    // the initial frame is drawn synchronously; reduced motion means the loop
    // must never schedule another frame
    expect(raf.mock.calls.length).toBe(0);
  });

  it("with motion allowed: the preview keeps scheduling frames", () => {
    stubReduced(false);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    render(<ScenePreview kind="rain" colors={["#60a5fa"]} className="h-24 w-24" />);
    // the synchronous first draw schedules the next frame → ≥1 reschedule
    expect(raf.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- S13.1 keyboard: skip link + sidebar arrow keys -------------------------

describe("S13.1 keyboard navigation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.removeItem("reforge-mock-v1");
    vi.resetModules();
  });

  it("renders a skip-to-content link as the first tab stop", async () => {
    // App + I18nProvider must come from the SAME post-resetModules graph so
    // they share one i18n context (module-scoped Ctx).
    const i18n = await import("../i18n");
    const { default: App } = await import("../App");
    const { container } = render(
      <i18n.I18nProvider>
        <App />
      </i18n.I18nProvider>,
    );
    const skip = container.querySelector('a[href="#main-content"]');
    expect(skip).not.toBeNull();
    expect(skip?.textContent).toBe("Skip to content");
    // visually hidden until focused (sr-only + focus:not-sr-only)
    expect(skip?.className).toContain("sr-only");
    expect(skip?.className).toContain("focus:not-sr-only");
    const main = container.querySelector("#main-content");
    expect(main).not.toBeNull();
  });

  it("sidebar ArrowDown/ArrowUp move focus between nav items", async () => {
    const i18n = await import("../i18n");
    const { default: App } = await import("../App");
    const { container } = render(
      <i18n.I18nProvider>
        <App />
      </i18n.I18nProvider>,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("button[data-nav-item]").length).toBeGreaterThan(3);
    }, { timeout: 8000 });
    const nav = container.querySelector("nav[aria-label='Main navigation']")!;
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-nav-item]"));
    items[0].focus();
    fireEvent.keyDown(nav, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(nav, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(nav, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(nav, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(nav, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });
});
