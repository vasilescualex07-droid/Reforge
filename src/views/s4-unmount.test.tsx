// S4.7 — stale-state/unmount hygiene (B2).
// Performance is the one view that polls forever (get_performance every 1.2s).
// The `alive` flag must stop the chain on unmount — fast tab switches must not
// leave a zombie timer firing backend calls (and setState on unmounted views).
// This test proves it: wrap call() to count get_performance invocations,
// unmount mid-polling, and assert the count freezes.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import Performance from "./Performance";

const pollCount = vi.hoisted(() => ({ fired: 0 }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    call: (cmd: string, ...rest: unknown[]) => {
      if (cmd === "get_performance") pollCount.fired += 1;
      return (actual.call as (...a: unknown[]) => Promise<unknown>)(cmd, ...rest);
    },
  };
});

const POLL_MS = 1200;
const MOCK_CALL_MS = 200;

afterEach(() => {
  cleanup();
  pollCount.fired = 0;
});

it("stops polling after unmount — no zombie get_performance calls", { timeout: 15000 }, async () => {
  render(<Performance />);

  // Let the view settle: initial tick + the 200ms mock delay.
  await waitFor(() => expect(pollCount.fired).toBeGreaterThan(0), { timeout: 15000 });

  // Confirm it's actually polling: the count grows across a poll interval.
  const before = pollCount.fired;
  await act(async () => {
    await new Promise((r) => setTimeout(r, POLL_MS + MOCK_CALL_MS + 300));
  });
  const afterPoll = pollCount.fired;
  expect(afterPoll).toBeGreaterThan(before);

  // Unmount while the chain is live.
  cleanup();

  // Wait well past another poll interval — a leaked timer would fire again.
  const atUnmount = pollCount.fired;
  await act(async () => {
    await new Promise((r) => setTimeout(r, POLL_MS * 2 + 500));
  });
  expect(pollCount.fired).toBe(atUnmount);
});
