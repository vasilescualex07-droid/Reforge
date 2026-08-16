// Makeover session persistence (ROADMAP A3.1). Closing mid-flow must not lose
// your place — every state change is mirrored to localStorage so the next boot
// can offer "Resume makeover" from the Dashboard or the session page itself.

export interface SessionState {
  step: string; // snapshot | scan | clean | style | done
  maxStep: number;
  snapshotId: string | null;
  appliedName: string | null;
  freedBytes: number;
  dupPathsCount: number;
  savedAt: number;
}

const KEY = "reforge.makeover.session.v2";

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionState;
    if (!s || typeof s.step !== "string" || typeof s.savedAt !== "number") return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: SessionState) {
  try {
    const stamped = s.savedAt > 0 ? s : { ...s, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(stamped));
  } catch {
    /* storage full / private mode — resume just won't persist */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True when a resumable (not finished) makeover session exists. */
export function hasResumableSession(): boolean {
  const s = loadSession();
  return !!s && s.step !== "done";
}

export function sessionAgeMinutes(s: SessionState | null): number | null {
  if (!s?.savedAt) return null;
  return Math.max(0, Math.round((Date.now() - s.savedAt) / 60_000));
}
