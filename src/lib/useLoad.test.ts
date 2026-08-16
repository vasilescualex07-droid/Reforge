import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLoad } from "./useLoad";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));

vi.mock("./api", () => ({
  call: (...args: unknown[]) => callMock(...args),
  errorCopy: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock("../components/ui", () => ({ toast: () => {} }));

beforeEach(() => {
  callMock.mockReset();
});

describe("useLoad", () => {
  it("loads data on mount", async () => {
    callMock.mockResolvedValue([1, 2, 3]);
    const { result } = renderHook(() => useLoad<number[]>("list_things"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual([1, 2, 3]));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(callMock).toHaveBeenCalledWith("list_things", undefined);
  });

  it("surfaces an error instead of a silent blank", async () => {
    callMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useLoad<number[]>("list_things"));
    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.loading).toBe(false);
  });

  it("refresh() reloads and clears a stale error", async () => {
    callMock
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce([7]);
    const { result } = renderHook(() => useLoad<number[]>("list_things"));
    await waitFor(() => expect(result.current.error).toBe("first failure"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toEqual([7]));
    expect(result.current.error).toBeNull();
    expect(callMock).toHaveBeenCalledTimes(2);
  });
});
