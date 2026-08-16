import { useCallback, useEffect, useState } from "react";
import { errorCopy, call } from "../lib/api";
import type { BundleInfo, BundleManifest } from "../lib/types";
import { Modal, Section, toast } from "../components/ui";
import {
  IconRefresh, IconDownload, IconUpload, IconCheck, IconTrash, IconEye,
} from "../components/icons";

const COMPONENT_ICONS: Record<string, string> = {
  accent: "A",
  theme_mode: "T",
  wallpaper: "W",
  taskbar: "B",
  cursor: "C",
  sound_scheme: "S",
  sound_event: "S",
  scene: "S",
  font_sub: "F",
  lock_screen: "L",
};

const COMPONENT_LABELS: Record<string, string> = {
  accent: "Accent color",
  theme_mode: "Theme mode",
  wallpaper: "Wallpaper",
  taskbar: "Taskbar settings",
  cursor: "Cursor scheme",
  sound_scheme: "Sound scheme",
  sound_event: "Sound event",
  scene: "Animated wallpaper scene",
  font_sub: "Font substitution",
  lock_screen: "Lock screen",
};

function componentLabel(c: {
  type: string;
  asset?: string;
  hex?: string;
  mode?: string;
  scheme?: string;
  guid?: string;
  original?: string;
  event?: string;
}): string {
  const base = COMPONENT_LABELS[c.type] ?? c.type;
  const detail = c.hex ?? c.mode ?? c.scheme ?? c.guid ?? c.original ?? c.asset ?? c.event;
  return detail ? `${base} — ${detail}` : base;
}

// Pack thumbnail gradient based on components
function packGradient(manifest: BundleManifest): string {
  const accent = manifest.components.find((c) => c.type === "accent");
  const mode = manifest.components.find((c) => c.type === "theme_mode");
  const isDark = mode?.mode !== "light";
  const hex = accent?.hex ?? "#6D7CFF";
  if (isDark) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const dark = `rgb(${Math.floor(r * 0.15)},${Math.floor(g * 0.15)},${Math.floor(b * 0.15)})`;
    // content preview — renders the actual gradient accent of the pack
    return `linear-gradient(135deg, ${dark}, ${hex}44)`;
  }
  // content preview — renders the actual gradient accent of the pack
  return `linear-gradient(135deg, var(--gray-12), ${hex}33)`;
}

export default function Marketplace() {
  const [bundles, setBundles] = useState<BundleInfo[]>([]);
  const [importPath, setImportPath] = useState("");
  const [exportName, setExportName] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ bundle: BundleInfo; manifest: BundleManifest } | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BundleInfo | null>(null);

  const refresh = useCallback(() => {
    call<BundleInfo[]>("marketplace_list_bundles")
      .then(setBundles)
      .catch(() => toast("Could not load installed packs", "err"));
  }, []);

  useEffect(refresh, [refresh]);

  const importBundle = async () => {
    if (!importPath.trim()) return;
    setBusy(true);
    try {
      const b = await call<BundleInfo>("marketplace_import", { source: importPath });
      toast(`Installed "${b.name}" — review it below, then apply`);
      setImportPath("");
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const exportLook = async () => {
    setBusy(true);
    try {
      const b = await call<BundleInfo>("marketplace_export_look", { name: exportName });
      toast(`Captured current look as "${b.name}" — ready to share`);
      setExportName("");
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async (b: BundleInfo) => {
    try {
      const m = await call<BundleManifest>("marketplace_get_manifest", { bundle_id: b.id });
      setPreview({ bundle: b, manifest: m });
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  const applyBundle = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const msg = await call<string>("marketplace_apply_bundle", { bundle_id: preview.bundle.id });
      toast(msg);
      setPreview(null);
      setApplyOpen(false);
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const deleteBundle = async (b: BundleInfo) => {
    try {
      await call("marketplace_delete_bundle", { bundle_id: b.id });
      toast(`Removed "${b.name}"`);
      refresh();
    } catch (e) {
      toast(errorCopy(e), "err");
    }
  };

  return (
    <div className="space-y-4">
      <header className="page-head">
        <h1 className="page-title">Pack Marketplace</h1>
        <p className="page-subtitle">
          Shareable .reforgepack looks — capture your current setup, install packs from disk, and apply them as one
          reversible change. Fully local: nothing is downloaded unless you bring a pack file.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Export your look"
          subtitle="Capture accent, mode, wallpaper, taskbar, cursor & lock screen into a shareable pack"
        >
          <div className="flex gap-2">
            <input
              className="input"
              placeholder='Pack name, e.g. "Studio Blue"'
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
            />
            <button className="btn-primary shrink-0" onClick={exportLook} disabled={busy || !exportName.trim()}>
              <IconDownload size={14} /> Capture look
            </button>
          </div>
          <p className="mt-2 text-2xs text-[var(--text-tertiary)]">
            Exports into Reforge's packs folder. Copy that folder to another PC (or zip it) to share.
          </p>
        </Section>

        <Section title="Import a pack" subtitle="Point at a .reforgepack folder on disk">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="C:\path\to\my-look.reforgepack"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
            />
            <button className="btn-ghost shrink-0" onClick={importBundle} disabled={busy || !importPath.trim()}>
              <IconUpload size={14} /> Import
            </button>
          </div>
          <p className="mt-2 text-2xs text-[var(--text-tertiary)]">
            Packs are declarative data only — executable or script content is rejected on import.
          </p>
        </Section>
      </div>

      {/* Installed Packs Grid */}
      <Section
        title="Installed packs"
        subtitle="Apply a pack as a single undoable change — revert the whole look from History"
        actions={
          <button className="btn-ghost btn-sm shrink-0" onClick={refresh}>
            <IconRefresh size={12} /> Refresh
          </button>
        }
      >
        {bundles.length === 0 ? (
          <div className="empty-state">
            No packs installed yet. Capture your current look above, or import one from disk.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {bundles.map((b) => (
              <div
                key={b.id}
                className="group overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] transition-colors hover:border-[var(--border-accent)]"
              >
                {/* Pack thumbnail — flat neutral surface (no decorative gradient, Standard B §1) */}
                <div
                  className="relative h-28 w-full bg-[var(--surface-active)]"
                >
                  {b.applied && (
                    <div className="absolute right-3 top-3 badge badge-success">
                      <IconCheck size={10} /> Applied
                    </div>
                  )}
                  {!b.applied && (
                    <div className="absolute right-3 top-3 badge badge-neutral">Installed</div>
                  )}
                  {/* Component type badges */}
                  <div className="absolute bottom-3 left-3 flex gap-1">
                    {[...new Set(["accent", "mode", "wallpaper"])].map((type) => (
                      <span
                        key={type}
                        className="rounded bg-black/40 px-1.5 py-0.5 text-2xs text-white/80 backdrop-blur-sm"
                      >
                        {COMPONENT_ICONS[type] ?? type}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Pack info */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]" title={b.name}>{b.name}</div>
                      <div className="text-2xs text-[var(--text-tertiary)]">
                        v{b.version} · by {b.author}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-tertiary)]" title={b.description}>
                    {b.description}
                  </p>
                  <div className="mt-1 text-2xs text-[var(--text-tertiary)]">
                    {b.component_count} component(s)
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn-ghost btn-sm flex-1"
                      onClick={() => showPreview(b)}
                    >
                      <IconEye size={12} /> Preview
                    </button>
                    <button
                      className="btn-primary btn-sm flex-1"
                      disabled={busy}
                      onClick={() =>
                        showPreview(b).then(() => setApplyOpen(true))
                      }
                    >
                      Apply
                    </button>
                    <button
                      className="btn-ghost btn-sm text-[var(--text-tertiary)] hover:!text-[var(--status-danger)]"
                      onClick={() => setDeleteTarget(b)}
                      aria-label={`Remove pack ${b.name}`}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Preview Modal */}
      <Modal
        open={!!preview && !applyOpen}
        title={preview ? `Preview "${preview.bundle.name}"` : ""}
        onClose={() => setPreview(null)}
      >
        {preview && (
          <div className="space-y-4">
            {/* Pack header with gradient */}
            <div
              className="overflow-hidden rounded-xl px-4 py-4"
              style={{ background: packGradient(preview.manifest) }}
            >
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {preview.manifest.name}{" "}
                <span className="text-xs font-normal text-[var(--text-tertiary)]">
                  v{preview.manifest.version}
                </span>
              </div>
              <div className="text-2xs text-[var(--text-tertiary)]">
                by {preview.manifest.author}
              </div>
              {preview.manifest.description && (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {preview.manifest.description}
                </p>
              )}
            </div>

            {/* Component manifest */}
            <div>
              <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                What will change
              </div>
              <div className="space-y-1">
                {preview.manifest.components.length === 0 && (
                  <p className="text-xs text-[var(--text-tertiary)]">Nothing in this pack.</p>
                )}
                {preview.manifest.components.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                  >
                    <span>{COMPONENT_ICONS[c.type] ?? "•"}</span>
                    <span>{componentLabel(c)}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-2xs text-[var(--text-tertiary)]">
              Applying records one combined undo entry — the entire look reverts from{" "}
              <b>History</b> in one click.
            </p>
          </div>
        )}
      </Modal>

      {/* Apply Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        title={`Remove "${deleteTarget?.name}"?`}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteBundle(deleteTarget);
          setDeleteTarget(null);
        }}
        confirmLabel="Remove pack"
        danger
      >
        <p>
          This removes the pack from this PC. Already-applied changes are left untouched — you can still revert them
          from History.
        </p>
      </Modal>

      <Modal
        open={applyOpen && !!preview}
        title={`Apply "${preview?.bundle.name}"?`}
        onClose={() => setApplyOpen(false)}
        onConfirm={applyBundle}
        confirmLabel="Apply pack"
      >
        <p>
          This applies every component shown in the preview to your real Windows settings — accent, mode, wallpaper,
          and any taskbar / cursor / sound / lock-screen pieces it contains. The whole thing is recorded as a single
          reversible change, so you can revert it from History.
        </p>
      </Modal>
    </div>
  );
}
