// Curated sound schemes (S5.4). Every entry is a scheme that actually ships on
// stock Windows 10/11 — nothing invented:
//
//   ".Default"   — "Windows Default"  (the scheme itself)
//   ".None"      — "No Sounds"        (silence — a real design opinion)
//   "{f2e1dd92…}"— "Windows Default"  (the canonical GUID; stock Windows stores
//                 the default scheme under this GUID *or* under the plain name
//                 ".Default" — sounds.rs treats them as aliases of the same
//                 scheme, so either assignment applies on any machine).
//
// Custom user schemes can't be curated (they don't exist on a stock install),
// so these two distinct schemes are the full honest set.

export interface CuratedSoundScheme {
  guid: string;
  name: string;
  /** The distinct scheme — both Windows Default entries share this label. */
  scheme: "default" | "none";
}

export const CURATED_SOUND_SCHEMES: CuratedSoundScheme[] = [
  { guid: ".Default", name: "Windows Default", scheme: "default" },
  { guid: ".None", name: "No Sounds", scheme: "none" },
  {
    guid: "{f2e1dd92-4b1a-4f7e-8c5c-5d6b4c3a5d4b}",
    name: "Windows Default",
    scheme: "default",
  },
];

export const CURATED_GUIDS = CURATED_SOUND_SCHEMES.map((s) => s.guid);

/** The quiet look's scheme — No Sounds (Windows' built-in silent scheme). */
export const SOUND_SCHEME_NONE = { guid: ".None", name: "No Sounds" };

/** The default look's scheme, stored under the plain name Windows uses. */
export const SOUND_SCHEME_DEFAULT = { guid: ".Default", name: "Windows Default" };

/** Windows Default under its canonical GUID (aliases to ".Default" in sounds.rs). */
export const SOUND_SCHEME_CANONICAL = {
  guid: "{f2e1dd92-4b1a-4f7e-8c5c-5d6b4c3a5d4b}",
  name: "Windows Default",
};
