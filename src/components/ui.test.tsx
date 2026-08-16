import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KindChip, KIND_CHIP_STYLES, Modal, ScenePreview, Select, ToastHost, Toggle, toast } from "./ui";
import { UNDO_KINDS, UNDO_KIND_SET } from "../lib/undo-kinds";

describe("ToastHost (stack discipline, S3.7)", () => {
  // toast() pushes state outside of React events — every call must be wrapped
  // in act() or the DOM never re-renders; the fake-timer test restores real
  // timers in afterEach so userEvent-based suites later in the file don't hang
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes identical consecutive toasts", () => {
    render(<ToastHost />);
    act(() => {
      toast("Scanning for junk…", "info");
      toast("Scanning for junk…", "info");
      toast("Scanning for junk…", "info");
    });
    expect(screen.getAllByText("Scanning for junk…")).toHaveLength(1);
  });

  it("keeps different toasts but caps the stack at 4", () => {
    render(<ToastHost />);
    act(() => {
      for (let i = 1; i <= 6; i++) toast(`Message ${i}`);
    });
    expect(screen.getByText("Message 6")).toBeInTheDocument();
    expect(screen.getByText("Message 5")).toBeInTheDocument();
    expect(screen.getByText("Message 4")).toBeInTheDocument();
    expect(screen.getByText("Message 3")).toBeInTheDocument();
    expect(screen.queryByText("Message 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
  });

  it("dismisses manually", async () => {
    render(<ToastHost />);
    act(() => toast("Dismiss me"));
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    await userEvent.click(dismiss);
    expect(screen.queryByText("Dismiss me")).not.toBeInTheDocument();
  });

  it("clamps long notes and expands on click", async () => {
    render(<ToastHost />);
    const long = "This is a very long error message that should be clamped to two lines and then expand when the user clicks it — genuinely long so the affordance shows.";
    act(() => toast(long, "err"));
    const body = screen.getByText(long);
    expect(body.className).toContain("line-clamp-2");
    await userEvent.click(body);
    expect(body.className).not.toContain("line-clamp-2");
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("auto-dismisses after the timeout", () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => toast("Bye soon"));
    expect(screen.getByText("Bye soon")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5100));
    expect(screen.queryByText("Bye soon")).not.toBeInTheDocument();
  });
});

describe("Toggle", () => {
  it("renders the off state and reflects checked", () => {
    const { rerender } = render(<Toggle on={false} onChange={() => {}} label="Test" />);
    const btn = screen.getByRole("switch", { name: "Test" });
    expect(btn.getAttribute("aria-checked")).toBe("false");
    rerender(<Toggle on onChange={() => {}} label="Test" />);
    expect(screen.getByRole("switch", { name: "Test" }).getAttribute("aria-checked")).toBe("true");
  });

  it("fires onChange with the new value", async () => {
    const fn = vi.fn();
    render(<Toggle on={false} onChange={fn} label="Test" />);
    await userEvent.click(screen.getByRole("switch", { name: "Test" }));
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("respects disabled state", async () => {
    const fn = vi.fn();
    render(<Toggle on={false} onChange={fn} label="Test" disabled />);
    await userEvent.click(screen.getByRole("switch", { name: "Test" }));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("opens with role=dialog and the title", () => {
    render(
      <Modal open title="Dialog title" onClose={() => {}} confirmLabel="Go">
        body text
      </Modal>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Dialog title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Modal open title="T" onClose={onClose}>{null}</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses inside the dialog on open and traps Tab", async () => {
    render(
      <Modal open title="T" onClose={() => {}} confirmLabel="Primary">
        <button>Inner</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    // focus lands inside the dialog (after the mount timeout)
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Tab from the last element wraps back to the first
    const last = screen.getByRole("button", { name: "Primary" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("locks body scroll while open and restores it after close", () => {
    const { rerender } = render(<Modal open title="T" onClose={() => {}}>{null}</Modal>);
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Modal open={false} title="T" onClose={() => {}}>{null}</Modal>);
    expect(document.body.style.overflow).toBe("");
  });

  it("is announced as a modal labelled by its title (aria-modal + aria-labelledby)", () => {
    render(
      <Modal open title="Pick a look" onClose={() => {}}>
        body
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledby = dialog.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    const title = document.getElementById(labelledby!);
    expect(title?.textContent).toBe("Pick a look");
  });

  it("wraps Shift+Tab backwards from the first element to the last", async () => {
    render(
      <Modal open title="T" onClose={() => {}} confirmLabel="Confirm">
        <button>Inner</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "Inner" });
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm" }));
  });

  it("restores focus to the element that opened it", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<Modal open title="T" onClose={() => {}}>{null}</Modal>);
    rerender(<Modal open={false} title="T" onClose={() => {}}>{null}</Modal>);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it("closes on backdrop click but not on clicks inside the dialog", async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="T" onClose={onClose} confirmLabel="Keep me">
        <button>Inner</button>
      </Modal>
    );
    await userEvent.click(screen.getByRole("button", { name: "Inner" }));
    expect(onClose).not.toHaveBeenCalled();
    // click the backdrop itself (the fixed overlay)
    const backdrop = document.querySelector(".fixed.inset-0");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ScenePreview", () => {
  it("renders a canvas", () => {
    render(<ScenePreview kind="particles" colors={["#38bdf8"]} className="h-10" />);
    expect(document.querySelector("canvas")).toBeInTheDocument();
  });

  it("still renders after palette change without re-mounting the canvas", () => {
    const { rerender } = render(<ScenePreview kind="particles" colors={["#38bdf8"]} className="h-10" />);
    rerender(<ScenePreview kind="particles" colors={["#38bdf8", "#818cf8"]} className="h-10" />);
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
  });
});

describe("KindChip", () => {
  it("renders every known kind with a chip class and humanized label", () => {
    const kinds = [
      "accent",
      "mode",
      "style_applied",
      "video_wallpaper",
      "duplicates_removed",
      "power_plan",
      "cursors",
      "sort",
      "wallpaper",
    ];
    for (const k of kinds) {
      const { container } = render(<KindChip kind={k} />);
      expect(container.querySelector("span")?.className).toContain("badge");
      expect(screen.getByText(k.replace(/_/g, " "))).toBeInTheDocument();
    }
  });

  it("falls back to neutral for unknown kinds", () => {
    const { container } = render(<KindChip kind="brand_new_kind" />);
    expect(container.querySelector("span")?.className).toContain("badge-neutral");
  });

  // S3.3 / K9 — the canonical undo-kind list (extracted from Rust) must be
  // styled 1:1: no kind without a chip style, no stale style without a kind.
  it("styles every canonical undo kind and nothing else (K9 parity)", () => {
    // every canonical kind has an EXPLICIT style entry (neutral is a valid
    // explicit choice — the point is it's declared, not the implicit fallback)
    for (const k of UNDO_KINDS) {
      expect(KIND_CHIP_STYLES[k], `kind ${k} must have a chip style`).toBeTruthy();
    }
    const styled = new Set(Object.keys(KIND_CHIP_STYLES));
    expect(styled).toEqual(UNDO_KIND_SET);
  });

  it("renders every canonical kind without crashing", () => {
    for (const k of UNDO_KINDS) {
      const { container } = render(<KindChip kind={k} />);
      expect(container.querySelector("span")?.textContent).toBe(k.replace(/_/g, " "));
    }
  });
});

describe("Select", () => {
  it("opens on click and fires onChange with the picked value", async () => {
    const fn = vi.fn();
    render(
      <Select
        value="a"
        onChange={fn}
        options={[
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
        ]}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Option A" }));
    await userEvent.click(screen.getByRole("option", { name: "Option B" }));
    expect(fn).toHaveBeenCalledWith("b");
  });
});
