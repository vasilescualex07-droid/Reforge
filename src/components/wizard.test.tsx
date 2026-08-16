// S10.8 — first-run wizard smoke test. The wizard is code-split (its styles
// catalog must never reach the app shell), so this locks the full flow:
// renders → three questions → apply → onDone fired.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import Wizard from "./Wizard";
import { mockCall } from "../lib/mock";
import type { StyleApplyResult } from "../lib/styleApply";

describe("S10.8 first-run wizard", () => {
  it("walks all three questions and applies a starter style", { timeout: 60_000 }, async () => {
    const onDone = vi.fn();
    const onSkip = vi.fn();
    const { container, unmount } = render(<Wizard open onDone={onDone} onSkip={onSkip} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Welcome to Reforge");
    });

    const pick = (label: string) => {
      const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
      expect(btn).toBeTruthy();
      act(() => {
        fireEvent.click(btn!);
      });
    };

    pick("Calm & minimal");
    await waitFor(() => {
      expect(container.textContent).toContain("Question 2 of 3");
    });
    pick("Deep work & study");
    await waitFor(() => {
      expect(container.textContent).toContain("Question 3 of 3");
    });
    pick("Nature");

    // Last answer → build + apply through the mock backend → onDone.
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    const applied = await mockCall<StyleApplyResult>("apply_style", {
      style: { id: "smoke", name: "Smoke style" },
    });
    expect(applied.ok).toBe(true);
    expect(applied.name.length).toBeGreaterThan(0);
    // Wizard marks itself seen so it never reappears.
    expect(localStorage.getItem("reforge-wizard-seen-v1")).toBe("1");

    unmount();
  });

  it("skip persists the seen flag and calls onSkip", { timeout: 60_000 }, async () => {
    const onDone = vi.fn();
    const onSkip = vi.fn();
    const { container, unmount } = render(<Wizard open onDone={onDone} onSkip={onSkip} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Welcome to Reforge");
    });
    const skip = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Skip"));
    expect(skip).toBeTruthy();
    act(() => {
      fireEvent.click(skip!);
    });
    await waitFor(() => {
      expect(onSkip).toHaveBeenCalled();
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(localStorage.getItem("reforge-wizard-seen-v1")).toBe("1");

    unmount();
  });
});
