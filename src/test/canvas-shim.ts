// Minimal canvas shim for the widgets tests. jsdom has no real canvas; the
// global setup stubs `getContext("2d")` with a fake context that covers the
// existing views. The particle engine additionally uses setTransform /
// drawImage / ellipse / quadraticCurveTo, which are patched on here so the
// engine's pure math is testable without a browser.
export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: h, configurable: true });
  canvas.width = w;
  canvas.height = h;
  const orig = canvas.getContext.bind(canvas);
  canvas.getContext = ((kind: string) => {
    const ctx = orig(kind) as CanvasRenderingContext2D | null;
    if (kind === "2d" && ctx) {
      const anyCtx = ctx as unknown as Record<string, unknown>;
      if (typeof anyCtx.setTransform !== "function") anyCtx.setTransform = () => {};
      if (typeof anyCtx.drawImage !== "function") anyCtx.drawImage = () => {};
      if (typeof anyCtx.ellipse !== "function") anyCtx.ellipse = () => {};
      if (typeof anyCtx.quadraticCurveTo !== "function") anyCtx.quadraticCurveTo = () => {};
      if (typeof anyCtx.createLinearGradient !== "function")
        anyCtx.createLinearGradient = () => ({ addColorStop: () => {} });
      if (typeof anyCtx.measureText !== "function") anyCtx.measureText = () => ({ width: 0 });
    }
    return ctx;
  }) as typeof canvas.getContext;
  return canvas;
}
