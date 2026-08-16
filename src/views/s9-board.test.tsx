// S9.6 — widget board preview (A5.6): Makeover renders a mini desktop mock with
// the live scene behind and widgets at their real (scaled) positions. Also
// locks S9.2's save_widget_layout + S9.4's auto-hide settings through the mock.
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import Makeover from "./Makeover";
import { mockCall } from "../lib/mock";
import type { WidgetConfig, WidgetsSettings } from "../lib/types";

function boardSection(container: HTMLElement): HTMLElement {
  const section = Array.from(container.querySelectorAll("section")).find((el) =>
    el.textContent?.includes("Widget board"),
  );
  if (!section) throw new Error("Widget board section not found");
  return section;
}

async function seedWidgets() {
  await mockCall("create_widget", { kind: "clock" });
  await mockCall("create_widget", { kind: "stats" });
  // place the stats widget somewhere distinctive
  const widgets = await mockCall<WidgetConfig[]>("list_widgets", {});
  const stats = widgets.find((w) => w.kind === "stats")!;
  await mockCall<WidgetConfig>("save_widget_layout", {
    id: stats.id,
    x: 900,
    y: 400,
    w: 260,
    h: 170,
  });
}

describe("S9.6 widget board preview", () => {
  it("renders the desktop mock with widget cards at scaled positions", { timeout: 60_000 }, async () => {
    await seedWidgets();
    const { container } = render(<Makeover />);
    const section = boardSection(container);
    await waitFor(() => {
      expect(section.querySelectorAll(".aspect-\\[16\\/9\\]").length).toBeGreaterThan(0);
    });
    // both seeded widgets appear on the board
    await waitFor(() => {
      const labels = Array.from(section.querySelectorAll("span.font-medium")).map((s) => s.textContent);
      expect(labels).toContain("clock");
      expect(labels).toContain("stats");
    });
    // stats widget was placed at (900,400) on a 1920x1080 desktop → ~47%/37%
    const cards = Array.from(section.querySelectorAll<HTMLElement>("div.absolute"));
    const statsCard = cards.find((c) => c.textContent?.includes("stats"));
    expect(statsCard).toBeDefined();
    const style = statsCard!.getAttribute("style") ?? "";
    expect(style).toMatch(/left:\s*46\.\d+%/);
    expect(style).toMatch(/top:\s*37\.\d+%/);
  });

  it("auto-hide toggle round-trips through the mock", { timeout: 60_000 }, async () => {
    const { container } = render(<Makeover />);
    const section = Array.from(container.querySelectorAll("section")).find((el) =>
      el.textContent?.includes("Auto-hide on fullscreen"),
    );
    expect(section).toBeDefined();
    const toggle = await waitFor(() => {
      const t = section!.querySelector("button[role='switch']");
      if (!t) throw new Error("no toggle");
      return t;
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => { fireEvent.click(toggle); });
    await new Promise((r) => setTimeout(r, 450));
    const s = await mockCall<WidgetsSettings>("get_widgets_settings", {});
    expect(s.autohide_fullscreen).toBe(false);
  });
});
