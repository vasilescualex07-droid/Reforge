import { describe, expect, it, beforeEach } from "vitest";
import {
  loadSession,
  saveSession,
  clearSession,
  hasResumableSession,
  sessionAgeMinutes,
  type SessionState,
} from "./sessionStore";

const base: SessionState = {
  step: "scan",
  maxStep: 2,
  snapshotId: "snap-123",
  appliedName: null,
  freedBytes: 1024,
  dupPathsCount: 3,
  savedAt: Date.now(),
};

beforeEach(() => {
  localStorage.clear();
});

describe("sessionStore", () => {
  it("round-trips a session through localStorage", () => {
    saveSession(base);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.step).toBe("scan");
    expect(loaded!.snapshotId).toBe("snap-123");
    expect(loaded!.dupPathsCount).toBe(3);
  });

  it("returns null when nothing is stored", () => {
    expect(loadSession()).toBeNull();
    expect(hasResumableSession()).toBe(false);
  });

  it("stamps savedAt on write", () => {
    saveSession({ ...base, savedAt: 0 });
    const loaded = loadSession();
    expect(loaded!.savedAt).toBeGreaterThan(0);
  });

  it("is not resumable once finished", () => {
    saveSession({ ...base, step: "done" });
    expect(hasResumableSession()).toBe(false);
  });

  it("is resumable mid-flow", () => {
    saveSession(base);
    expect(hasResumableSession()).toBe(true);
  });

  it("clears the stored session", () => {
    saveSession(base);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("rejects corrupted payloads", () => {
    localStorage.setItem("reforge.makeover.session.v2", "{not json");
    expect(loadSession()).toBeNull();
  });

  it("reports age in minutes", () => {
    expect(sessionAgeMinutes(null)).toBeNull();
    saveSession({ ...base, savedAt: Date.now() - 5 * 60_000 });
    expect(sessionAgeMinutes(loadSession())).toBe(5);
  });
});
