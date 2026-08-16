// S4.3 — view integration happy paths (A10.2/E1.5).
// Each test drives a real user flow against the REAL mock backend (api.call
// -> mockCall, 200ms per command) and asserts the outcome the roadmap promises:
// Dashboard metrics render; Tune-up scan reports junk; History reverts an entry;
// the Style quiz produces a top-3 and applies; the Makeover Session runs
// clean -> done; and the wallpaper gallery mounts 0 media on load.
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { call } from "../lib/api";
import { ToastHost } from "../components/ui";
import Dashboard from "./Dashboard";
import History from "./History";
import Makeover from "./Makeover";
import MakeoverSession from "./MakeoverSession";
import Tuneup from "./Tuneup";

// ToastHost installs pushToast (module-level); mounting it as a sibling of
// the view in the same tree makes toasts assertable. ToastHost takes no
// children prop, so it cannot wrap the view.
function withToasts(node: React.ReactNode) {
  return render(
    <>
      <ToastHost />
      {node}
    </>,
  );
}

/** Click the current quiz question's first option. The two quiz UIs use
 *  different layouts (Makeover: options in a modal dialog; MakeoverSession:
 *  options inside a Section card), so a global class query is hopeless — the
 *  toast card's message button and dozens of pack/style cards share the
 *  text-left classes. Anchor on the "Question X of Y" progress label and
 *  scope to its nearest section/dialog ancestor. */
function clickFirstQuizOption(container: HTMLElement) {
  const progress = Array.from(container.querySelectorAll<HTMLElement>("span, div")).find((el) =>
    /^Question \d+ of \d+/.test(el.textContent?.trim() ?? ""),
  );
  if (!progress) throw new Error("quiz progress label not found");
  const root = progress.closest('section, [role="dialog"]') ?? progress.parentElement?.parentElement;
  if (!root) throw new Error("quiz root not found");
  const options = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter((b) =>
    (b.className ?? "").includes("text-left"),
  );
  const opt = options[0];
  if (!opt) throw new Error("quiz option button not found");
  fireEvent.click(opt);
}

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("S4.3 view integration happy paths (real mock backend)", () => {
  it("Dashboard renders live metrics: health + personalization score + features", { timeout: 120_000 }, async () => {
    const { container } = render(<Dashboard />);
    await waitFor(
      () => expect(container.textContent).toContain("Personalization Score"),
      { timeout: 8000 },
    );
    // Metrics arrive async (get_dashboard_metrics 200ms) — waitFor, never a
    // fixed settle (a fixed sleep was flaky in the full-suite run).
    // get_dashboard_metrics always includes the accent feature → score ≥ 50.
    await waitFor(() => expect(container.textContent).toContain("Custom accent #6D7CFF"), { timeout: 8000 });
    expect(container.textContent).toContain("PC Health Score");
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
  });

  it("Tune-up scan reports junk with a toast and enables the clean button", { timeout: 120_000 }, async () => {
    const { container } = withToasts(<Tuneup />);
    await waitFor(() => expect(container.textContent).toContain("Scan now"), { timeout: 8000 });
    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Scan now"))!);

    await waitFor(
      () => expect(container.textContent).toContain("of junk found across"),
      { timeout: 8000 },
    );
    await settle(300);
    // The toast fired through ToastHost, and the clean action is armed.
    expect(container.textContent).toMatch(/Found .* of junk/);
    expect(container.textContent).toContain("Clean selected");
    expect(container.textContent).not.toContain("undefined");
  });

  it("History reverts a single entry with a toast", { timeout: 120_000 }, async () => {
    // Seed the shared mock store with revertible entries before the view loads.
    await call("set_blue_light", { on: true, intensity: 0.4 });
    await call("set_wallpaper", { path: "reforge://wallpapers/midnight-rain.png" });

    const { container } = withToasts(<History />);
    await waitFor(
      () => {
        const hasRevert = Array.from(container.querySelectorAll("button")).some(
          (b) => (b.textContent ?? "").trim() === "Revert",
        );
        expect(hasRevert).toBe(true); // throwing matcher — waitFor polls reliably
      },
      { timeout: 8000 },
    );
    const revertBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Revert",
    )!;
    fireEvent.click(revertBtn);
    await waitFor(() => expect(container.textContent).toMatch(/Reverted:/), { timeout: 8000 });
    expect(container.textContent).toMatch(/reverted/i);
  });

  it("Style quiz answers all questions → top 3 → apply fires an Applied toast", { timeout: 120_000 }, async () => {
    const { container } = withToasts(<Makeover />);
    // The Style quiz button appears in two sections once loads settle.
    await waitFor(() => expect(container.textContent).toContain("Style quiz"), { timeout: 12000 });
    await settle(400);
    const quizBtn = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Style quiz")!;
    fireEvent.click(quizBtn);
    await waitFor(() => expect(container.textContent).toMatch(/Question 1 of (\d+)/), { timeout: 8000 });
    const total = Number(container.textContent!.match(/Question 1 of (\d+)/)![1]);
    expect(total).toBeGreaterThan(0);

    for (let q = 0; q < total; q++) {
      await settle(60);
      clickFirstQuizOption(container);
    }

    await waitFor(() => expect(container.textContent).toContain("Your top 3 matches"), { timeout: 8000 });
    await settle(200);
    const apply = Array.from(container.querySelectorAll("button")).find((b) => /^Apply “/.test(b.textContent ?? ""))!;
    expect(apply).toBeTruthy();
    fireEvent.click(apply);
    await waitFor(() => expect(container.textContent).toContain("Applied"), { timeout: 10000 });
    expect(container.textContent).not.toContain("undefined");
  });

  it("Makeover Session: snapshot → scan → clean → style → done", async () => {
    const { container } = withToasts(<MakeoverSession />);
    await waitFor(
      () => expect(container.textContent).toContain("Take a snapshot"),
      { timeout: 8000 },
    );
    const snapBtn = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Take a snapshot")!;
    fireEvent.click(snapBtn);

    // Snapshot verifies on disk (extra call), then auto-advances: scan runs
    // automatically and lands on the clean step with defaults selected.
    // NOTE: waitFor only polls reliably when the predicate THROWS on failure
    // (a plain boolean return resolves instantly in this vitest setup), so the
    // assertion uses a throwing matcher.
    await waitFor(
      () => {
        const found = Array.from(container.querySelectorAll("button")).some((b) =>
          (b.textContent ?? "").includes("Clean & continue"),
        );
        expect(found).toBe(true);
      },
      { timeout: 20000 },
    );
    await settle(300);
    const cleanBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Clean & continue"),
    )!;
    expect((cleanBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cleanBtn);

    // Clean completes → style step with the inline quiz.
    await waitFor(() => expect(container.textContent).toMatch(/Question 1 of (\d+)/), { timeout: 20000 });
    const total = Number(container.textContent!.match(/Question 1 of (\d+)/)![1]);
    for (let q = 0; q < total; q++) {
      await settle(60);
      clickFirstQuizOption(container);
    }
    await waitFor(() => expect(container.textContent).toContain("Your top 3 looks"), { timeout: 10000 });
    await settle(200);
    const apply = Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Apply")!;
    fireEvent.click(apply);
    await waitFor(() => expect(container.textContent).toContain("Applied ✓"), { timeout: 10000 });
    await settle(200);

    const finish = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Finish"),
    )!;
    fireEvent.click(finish);
    await waitFor(() => expect(container.textContent).toContain("Step 5 · Done"), { timeout: 10000 });
    expect(container.textContent).toContain("Snapshot active");
    expect(container.textContent).not.toContain("undefined");
  }, 120_000);

  it("Wallpaper gallery mounts 0 media on load; expanded tiles are lazy", { timeout: 120_000 }, async () => {
    const { container } = render(<Makeover />);
    await waitFor(() => expect(container.textContent).toContain("Wallpaper library"), { timeout: 12000 });
    await settle(300);

    // Collapsed by default — not a single <img>/<video> in the DOM yet (C1.9).
    expect(container.querySelectorAll("img, video").length).toBe(0);

    const header = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Wallpaper library"),
    )!;
    fireEvent.click(header);
    await settle(200);

    // Expanded: static tiles are lazy-loaded, live tiles preload="none" and
    // stay paused — media is never actively pulled in by mounting alone.
    const imgs = container.querySelectorAll<HTMLImageElement>("img");
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.getAttribute("loading")).toBe("lazy");
    const vids = container.querySelectorAll<HTMLVideoElement>("video");
    for (const v of vids) {
      expect(v.preload).toBe("none");
      expect(v.paused).toBe(true);
    }
  });
});
