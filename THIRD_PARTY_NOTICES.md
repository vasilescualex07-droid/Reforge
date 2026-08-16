# Third-Party Notices

Reforge bundles third-party assets. Per the project's Development Standards
(Standard A §6), every asset ships with license/attribution tracked alongside
the file — see also `public/wallpapers/ATTRIBUTION.md` next to the wallpapers
themselves.

## FFmpeg (sidecar executable)

- **Files:** `src-tauri/resources/bin/ffmpeg.exe` (and siblings, if any)
- **Project:** FFmpeg — https://ffmpeg.org
- **License:** LGPL v2.1+ / GPL v2+ (build-dependent). The bundled build is an
  LGPL build; full license text: https://ffmpeg.org/legal.html
- **Version:** see `ffmpeg -version` at runtime; the sidecar is downloaded
  separately and not built from source here.
- **Notice:** FFmpeg includes third-party code under compatible licenses
  (e.g. zlib, libvpx, x264, OpenH264, etc. depending on the build). The
  complete FFmpeg license notice is available at the URL above and is
  incorporated by reference.

## Wallpapers (60 bundled images)

- **30 static wallpapers** — sourced from **Unsplash** (see
  `public/wallpapers/ATTRIBUTION.md` for the per-file credits and the
  Unsplash License summary).
- **30 live wallpapers** — sourced from **Mixkit** (see
  `public/wallpapers/ATTRIBUTION.md`).

### Unsplash License (summary)

Unsplash grants a nonexclusive, worldwide, perpetual, irrevocable, royalty-free
license to download, copy, modify, distribute, and use photos free of charge,
including for commercial purposes, provided you don't compile photos to
replicate a similar or competing service. Full text:
https://unsplash.com/license

### Mixkit License (summary)

Mixkit stock video/art is free to use in personal and commercial projects
without attribution, provided the content is not resold or redistributed as
stock/standalone media. Full text: https://mixkit.co/license/

## Fonts

Reforge uses system fonts only (Segoe UI / Cascadia Code) — no font files are
bundled.
