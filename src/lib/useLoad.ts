import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorCopy } from "./api";
import { toast } from "../components/ui";

// S2.1 — shared loader hook (audit H3: the biggest UX lie was 63 silent
// `.catch(() => {})` sites). Fires exactly ONE toast per command per session
// on the first failure, then stays quiet — no toast spam when the backend is
// flaky — while the view still gets a real `error` to render an InlineAlert
// or empty state instead of a dead blank.
//
// Usage:
//   const { data, error, loading, refresh } = useLoad<T>("list_things");
//   if (error) return <InlineAlert>{error}</InlineAlert>;
//   ...
export function useLoad<T>(
  cmd: string,
  args?: Record<string, unknown>,
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const notified = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call<T>(cmd, args)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        const copy = errorCopy(e);
        setError(copy);
        if (!notified.current) {
          notified.current = true;
          toast(copy, "err");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // args is intentionally excluded: callers pass inline objects, so putting
    // it in deps would refetch on every render. Call refresh() after a
    // mutation instead of relying on the args identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh };
}

// S7.2 — per-section data fetch. Same contract as useLoad, but nothing runs
// until `load()` is called (when the owning section first scrolls into view),
// so a big page like Makeover doesn't fire ~20 commands at mount.
export function useLazyLoad<T>(cmd: string, args?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const requested = useRef(false);
  const notified = useRef(false);

  useEffect(() => {
    if (!requested.current) return;
    let cancelled = false;
    setLoading(true);
    call<T>(cmd, args)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        const copy = errorCopy(e);
        setError(copy);
        if (!notified.current) {
          notified.current = true;
          toast(copy, "err");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // args intentionally excluded (same rationale as useLoad).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd, tick]);

  /** First call triggers the fetch; later calls are no-ops until refresh(). */
  const load = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    setTick((t) => t + 1);
  }, []);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh, load };
}

// S7.2 — fire `onVisible` once, the first time the returned ref's element
// scrolls near the viewport (400px pre-load margin). The element does not
// have to be fully on screen — just approaching it.
export function useVisibleOnce(onVisible: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !fired.current) {
          fired.current = true;
          cb.current();
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
