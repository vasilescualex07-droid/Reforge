// S13.5 — i18n framework.
//
// Dot-namespaced string catalogs (src/i18n/*.json), a `t()` lookup with
// `{placeholder}` interpolation, and a React provider so components re-render
// when the language changes. The language choice is persisted to localStorage
// (per-user UI preference — never touches app data).
//
// Fallback chain: current locale → English → the key itself (so a missing
// key degrades to a visible, fixable string instead of a crash).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import en from "./en.json";
import es from "./es.json";

export type Lang = "en" | "es";
export const LANGS: Lang[] = ["en", "es"];
export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Español" };

const DICTS: Record<Lang, Record<string, string>> = { en, es };
const STORAGE_KEY = "reforge-lang";

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

function lookup(dict: Record<string, string>, key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
}

/**
 * Default context (no provider): English + no-op setLang. Components like
 * Settings are rendered standalone in tests, and a missing provider must
 * degrade to readable English, never a crash. Production always mounts
 * <I18nProvider> (src/main.tsx), so the switcher only works there.
 */
const DEFAULT_CTX: I18nCtx = {
  lang: "en",
  setLang: () => {
    /* no provider — nothing to switch */
  },
  t: (key, vars) => lookup(DICTS.en, key, vars),
};

const Ctx = createContext<I18nCtx>(DEFAULT_CTX);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
      return saved && saved in DICTS ? saved : "en";
    } catch {
      return "en";
    }
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable — language just won't persist */
    }
  }, []);

  const t = useCallback<TFunc>((key, vars) => lookup(DICTS[lang], key, vars), [lang]);

  const value = useMemo<I18nCtx>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  return useContext(Ctx);
}
