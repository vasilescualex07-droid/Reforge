// S12.1 — auto-updater UI: the Settings "Updates" section shows an honest
// result for every check state, downloads + verifies a stage, and flips to
// "Verified · ready to install" instead of a dead end. The version compare /
// sha256 / manifest-parsing logic is covered by Rust tests in updater.rs;
// these cover the UI wiring + mock round-trip.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { ToastHost } from "../components/ui";
import Settings from "./Settings";

const STORE_KEY = "reforge-mock-v1";

async function reloadedMock() {
  vi.resetModules();
  return import("../lib/mock");
}

afterEach(() => {
  localStorage.removeItem(STORE_KEY);
  vi.resetModules();
});

function withToasts(node: React.ReactNode) {
  return render(
    <>
      <ToastHost />
      {node}
    </>,
  );
}

describe("S12 delivery & platform", () => {
  it("S12.1 no network (preview): check reports an honest error, not a fake update", { timeout: 120_000 }, async () => {
    await reloadedMock();
    const { container } = withToasts(<Settings />);
    await waitFor(() => expect(container.textContent).toContain("Check for updates"), { timeout: 8000 });
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Check for updates")!);
    await waitFor(() => expect(container.textContent).toContain("Couldn't check for updates"), { timeout: 8000 });
  });

  it("S12.1 update available: banner shows notes, download stages, banner says ready to install", { timeout: 120_000 }, async () => {
    const m = await reloadedMock();
    await m.mockCall("mock_set_update_result", {
      result: {
        state: "update-available",
        current: "0.1.0",
        latest: "0.2.0",
        url: "https://example.com/reforge-0.2.0.exe",
        sha256: "a".repeat(64),
        notes: ["New engine scenes", "Faster startup"],
        message: null,
      },
    });
    const { container } = withToasts(<Settings />);
    await waitFor(() => expect(container.textContent).toContain("Check for updates"), { timeout: 8000 });
    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Check for updates")!);
    await waitFor(() => expect(container.textContent).toContain("Reforge 0.2.0 is available"), { timeout: 8000 });
    expect(container.textContent).toContain("New engine scenes");

    fireEvent.click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Download")!);
    await waitFor(() => expect(container.textContent).toContain("Verified · ready to install"), { timeout: 8000 });
    expect(container.textContent).toContain("Applies silently on next launch");
  });

  it("S12.1 check-on-startup toggle persists through set_update_config", { timeout: 120_000 }, async () => {
    await reloadedMock();
    const { container } = withToasts(<Settings />);
    // The manifest URL only renders after get_update_config resolves — that is
    // the load signal (a click before it would hit the null-config guard).
    await waitFor(() => expect(container.textContent).toContain("reforge.app/releases/latest.json"), { timeout: 8000 });
    const toggle = container.querySelector('button[aria-label="Check on startup"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle!);
    await waitFor(() => expect(toggle?.getAttribute("aria-checked")).toBe("true"), { timeout: 8000 });
  });
});
