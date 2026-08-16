// S4.2 — component token tests (finish the partial).
// Meter + ScoreRing math/clamping/color tokens, and ScenePreview IO-gating
// proven with a CONTROLLABLE IntersectionObserver (setup.ts's stub always
// reports intersecting, so this file swaps in a driver that can fire
// intersect/leave events on demand) + fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Meter, ScenePreview, ScoreRing } from "./ui";

// A controllable IntersectionObserver the component under test will observe.
// It captures the callback + observed target so the test can drive visibility.
class ControlledIO implements IntersectionObserver {
  static instances: ControlledIO[] = [];
  readonly root: Element | null = null;
  readonly rootMargin = "200px";
  readonly thresholds: readonly number[] = [0];
  readonly cb: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ControlledIO.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Drive the observer: report the first observed target as on/off screen. */
  fire(intersecting: boolean) {
    const target = this.observed[0];
    if (!target) throw new Error("ControlledIO.fire called before observe()");
    this.cb([{ isIntersecting: intersecting, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

// The shared fake 2d context installed by src/test/setup.ts — clearRect is a
// vi.fn, so we can count actual draw frames.
function sharedCtx(): CanvasRenderingContext2D {
  return (HTMLCanvasElement.prototype.getContext as unknown as () => CanvasRenderingContext2D)();
}
function drawCount(): number {
  return (sharedCtx().clearRect as ReturnType<typeof vi.fn>).mock.calls.length;
}

beforeEach(() => {
  vi.useFakeTimers();
  ControlledIO.instances.length = 0;
  vi.stubGlobal("IntersectionObserver", ControlledIO);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Meter (S4.2)", () => {
  it("renders the fill at value/max percent and rounds", () => {
    const { container } = render(<Meter value={50} max={200} />);
    const fill = container.querySelector("div[style*='width']") as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("clamps above 100% to 100%", () => {
    const { container } = render(<Meter value={900} max={100} />);
    const fill = container.querySelector("div[style*='width']") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("never emits NaN for max <= 0 (divide-by-zero guard fills the track)", () => {
    const { container } = render(<Meter value={10} max={0} />);
    const fill = container.querySelector("div[style*='width']") as HTMLElement;
    expect(fill.style.width).not.toContain("NaN");
    expect(fill.style.width).toMatch(/^\d+%$/);
  });

  it("applies the color and height tokens", () => {
    const { container } = render(<Meter value={5} max={10} color="var(--status-danger)" height={10} />);
    const track = container.querySelector("div.overflow-hidden") as HTMLElement;
    const fill = track.firstElementChild as HTMLElement;
    expect(fill.style.background).toBe("var(--status-danger)");
    expect(track.style.height).toBe("10px");
  });

  it("defaults to the accent token when no color is given", () => {
    const { container } = render(<Meter value={5} max={10} />);
    const fill = container.querySelector("div[style*='width']") as HTMLElement;
    expect(fill.style.background).toBe("var(--accent-hex)");
  });
});

describe("ScoreRing (S4.2)", () => {
  function ringStroke(score: number): string {
    const { container } = render(<ScoreRing score={score} />);
    const circle = container.querySelector("circle[stroke-dasharray]") as SVGElement;
    return circle.getAttribute("stroke-dasharray") ?? "";
  }

  it("shows the numeric score", () => {
    const { container } = render(<ScoreRing score={73} />);
    expect(container.textContent).toContain("73");
    expect(container.textContent).toContain("Health");
  });

  it("fills the arc proportionally at a mid score", () => {
    const dash = ringStroke(50);
    const [filled, gap] = dash.split(" ").map(Number);
    const c = 2 * Math.PI * 54;
    expect(filled).toBeCloseTo(c / 2, 0);
    expect(gap).toBeCloseTo(c / 2, 0);
  });

  it("clamps scores above 100 to a full ring (not >100% overflow)", () => {
    const dash = ringStroke(150);
    const [filled, gap] = dash.split(" ").map(Number);
    const c = 2 * Math.PI * 54;
    expect(filled).toBeCloseTo(c, 0);
    expect(gap).toBe(0);
  });

  it("clamps negative scores to an empty ring", () => {
    const dash = ringStroke(-5);
    const [filled] = dash.split(" ").map(Number);
    expect(filled).toBe(0);
  });

  it("uses the success token at >= 70, warning at >= 40, danger below", () => {
    const fillOf = (score: number) => {
      const { container, unmount } = render(<ScoreRing score={score} />);
      const stroke = container.querySelector("circle[stroke-dasharray]")?.getAttribute("stroke");
      unmount();
      return stroke;
    };
    expect(fillOf(85)).toBe("var(--status-success)");
    expect(fillOf(55)).toBe("var(--status-warning)");
    expect(fillOf(20)).toBe("var(--status-danger)");
  });
});

describe("ScenePreview IO gating (S4.2)", () => {
  it("animates while intersecting and freezes once scrolled out, then resumes", () => {
    render(<ScenePreview kind="particles" colors={["#818cf8"]} />);
    const io = ControlledIO.instances[0];
    expect(io.observed.length).toBe(1);

    // Initial draw happens on mount (one frame scheduled immediately).
    const base = drawCount();

    // Still on screen: the rAF loop keeps drawing.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const drawing = drawCount();
    expect(drawing).toBeGreaterThan(base);

    // Scroll out of view → rAF cancelled, drawing stops.
    act(() => {
      io.fire(false);
      vi.advanceTimersByTime(300);
    });
    const frozen = drawCount();
    expect(frozen).toBe(drawing);

    // Scroll back into view → animation resumes from a fresh frame.
    act(() => {
      io.fire(true);
      vi.advanceTimersByTime(200);
    });
    expect(drawCount()).toBeGreaterThan(frozen);
  });

  it("tears down the observer on unmount (no interval/observer leak)", () => {
    const { unmount } = render(<ScenePreview kind="stars" colors={["#fff"]} />);
    const io = ControlledIO.instances[0];
    const disconnect = vi.spyOn(io, "disconnect");
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
