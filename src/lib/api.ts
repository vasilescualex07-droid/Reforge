import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { AppErrorKind, AppErrorShape } from "./types";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Normalize a rejection value (from invoke or the mock) into the AppError
 *  shape. The Rust backend serializes AppError as { kind, message } via serde
 *  tag mode; the mock throws plain Errors — both become a Command error here,
 *  so views branch on shape, never on message text (Phase B2). */
export function toAppError(err: unknown): AppErrorShape {
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.kind === "string" && typeof o.message === "string") {
      return { kind: o.kind as AppErrorKind, message: o.message };
    }
    if (typeof o.message === "string") return { kind: "Command", message: o.message };
  }
  if (err instanceof Error) return { kind: "Command", message: err.message };
  return { kind: "Command", message: String(err ?? "unknown error") };
}

/** Standard B §4 error copy by shape — say what happened + what to do.
 *  Views call this in their catch handlers instead of writing their own
 *  generic "Something went wrong" (Phase B3). */
/** S2.2 — dev-mode console.warn shim for deliberate, cosmetic swallows
 *  (background polls, fire-and-forget persistence, hover autoplay).
 *  State-critical loads must use `useLoad` or an explicit error surface
 *  instead — this is only for cases where a failure genuinely has no UI
 *  impact. Loud in dev so future silent failures can't hide; no-op in prod. */
export function swallow(what: string, err?: unknown) {
  if (import.meta.env.DEV) console.warn(`[reforge] swallowed: ${what}`, err ?? "");
}

export function errorCopy(err: unknown): string {
  const e = toAppError(err);
  switch (e.kind) {
    case "Registry":
      return "Couldn't update the accent — Windows blocked the registry change. Try running Reforge as administrator.";
    case "NotFound":
      return "That item is gone — it may have been removed already.";
    case "Io":
      return "Couldn't read or write that file — check disk space and permissions, then try again.";
    case "Invalid":
      return e.message || "That input isn't valid — check it and try again.";
    case "Command": {
      const m = e.message || "";
      // S2.5 — the media pipeline and the Windows shell surface failures as
      // Command errors with domain-specific text; give each real copy instead
      // of a raw string. Matched by shape, never by exact message.
      if (/ffmpeg|transcod|video dimens|import media/i.test(m)) {
        return "Video processing failed — make sure the file is a valid MP4/WebM/GIF and isn't open in another app, then try again.";
      }
      // S2.5 — PowerShell/registry spawns surface as plain io errors
      // ("Access is denied (os error 5)", "program not found: powershell.exe");
      // without this they'd leak raw OS text into the toast.
      if (/access is denied|os error 5|permission denied|elevat/i.test(m)) {
        return "Windows blocked that — some changes need administrator rights. Run Reforge as administrator and try again.";
      }
      if (/powershell|explorer\.exe|shell|registry/i.test(m)) {
        return "Windows rejected that change — some tweaks need administrator rights. Run Reforge as administrator and try again.";
      }
      return m || "That didn't work — try again.";
    }
    default:
      return e.message || "That didn't work — try again.";
  }
}

// Shared formatting helpers live in format.ts; re-exported here so existing
// `import { fmt, fmtDate, fmtAge } from "../lib/api"` call sites keep working.
export { fmt, fmtAge, fmtDate } from "./format";

/** Subscribe to a backend progress/status event (E1: `scan-progress`,
 *  `transcode-progress`). In browser preview there is no backend, so this
 *  no-ops; in Tauri it wraps @tauri-apps/api/event and returns an
 *  unsubscribe fn for the view's useEffect cleanup. */
export function onEvent<T>(event: string, cb: (payload: T) => void): () => void {
  if (!IS_TAURI) return () => {};
  let cancelled = false;
  let un: (() => void) | null = null;
  tauriListen<T>(event, (e) => {
    if (!cancelled) cb(e.payload);
  })
    .then((f) => {
      if (cancelled) f();
      else un = f;
    })
    .catch((e) => swallow(`listen ${event}`, e));
  return () => {
    cancelled = true;
    un?.();
  };
}

/**
 * Resolve a wallpaper path to a real filesystem path.
 * Bundled wallpapers use /wallpapers/... paths that work in dev server
 * but need to be resolved to real OS paths for the wallpaper setter.
 * In Tauri, public/ assets are bundled — we call a backend helper to resolve.
 * Falls back to the raw path (works in dev server preview).
 */
export async function resolveWallpaperPath(publicPath: string): Promise<string> {
  // If it's already an absolute OS path, return as-is
  if (/^[A-Z]:\\/i.test(publicPath) || publicPath.startsWith("\\\\")) return publicPath;
  // If it's a bundled /wallpapers/ path, try to resolve via backend
  if (publicPath.startsWith("/wallpapers/")) {
    try {
      const resolved = await call<string>("resolve_wallpaper_path", { public_path: publicPath });
      return resolved;
    } catch {
      // Backend command not available — return raw path (dev server preview)
      return publicPath;
    }
  }
  return publicPath;
}

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (IS_TAURI) {
    return invoke<T>(cmd, args).catch((err) => {
      // S1.2 — a missing command means the running exe predates this frontend
      // (stale build). Surface a real banner in the shell instead of a raw
      // "command not found" toast. The error still propagates to the caller.
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(msg)) {
        try {
          window.dispatchEvent(
            new CustomEvent("reforge:command-not-found", { detail: { cmd } }),
          );
        } catch {
          /* non-DOM env — nothing to signal */
        }
      }
      throw err;
    });
  }
  // Browser preview only: the mock backend is a dev-time module (~1,400 lines)
  // loaded on demand so the production Tauri bundle never ships it (Phase B1).
  return import("./mock").then((m) => m.mockCall<T>(cmd, args));
}

/**
 * call() with a hard deadline. A hung command (e.g. a stuck transcode on a
 * slow disk) must never leave the UI stuck on "Applying…" forever — the
 * timeout rejects and the caller's catch/finally clears the busy state.
 */
export function callWithTimeout<T>(
  cmd: string,
  args: Record<string, unknown> | undefined,
  ms: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${cmd} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    call<T>(cmd, args).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
