import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  IconClose, IconCheck, IconInfo, IconWarning, IconDanger,
  IconChevronDown, IconSearch,
} from "./icons";

// ---------------------------------------------------------------------------
// Toasts — Win11 notification style (bottom-right, white card, icon left)
// ---------------------------------------------------------------------------

type Toast = { id: number; msg: string; kind: "ok" | "err" | "info" };
let pushToast: ((t: Toast) => void) | null = null;

export function toast(msg: string, kind: "ok" | "err" | "info" = "ok") {
  pushToast?.({ id: Date.now() + Math.random(), msg, kind });
}

const TOAST_META: Record<string, { Icon: typeof IconCheck; color: string; title: string }> = {
  ok: { Icon: IconCheck, color: "var(--status-success)", title: "Done" },
  err: { Icon: IconDanger, color: "var(--status-danger)", title: "That didn't work" },
  info: { Icon: IconInfo, color: "var(--status-info)", title: "Reforge" },
};

// long notes clamp to two lines and expand on click (S3.7 / B1.5) — a toast
// with more than this many chars gets the affordance
const TOAST_EXPAND_THRESHOLD = 110;

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const meta = TOAST_META[t.kind] ?? TOAST_META.info;
  const Icon = meta.Icon;
  const long = t.msg.length > TOAST_EXPAND_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="animate-slide-up pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3"
      style={{ boxShadow: "var(--shadow-elevation-dropdown)" }}
    >
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-[var(--surface-overlay)]"
        style={{ color: meta.color }}
      >
        <Icon size={16} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{meta.title}</div>
        <button
          type="button"
          onClick={() => {
            if (long) setExpanded((v) => !v);
          }}
          className={`mt-0.5 block w-full text-left text-sm text-[var(--text-secondary)] ${
            long && !expanded ? "line-clamp-2" : ""
          } ${long ? "cursor-pointer" : "cursor-default"}`}
          aria-expanded={long ? expanded : undefined}
          title={long ? (expanded ? "Show less" : "Show more") : undefined}
        >
          {t.msg}
        </button>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-xs font-medium text-[var(--text-accent)] hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
      <button
        onClick={onClose}
        className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        aria-label="Dismiss notification"
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    pushToast = (t) => {
      // dedupe identical consecutive toasts (S3.7 / B1.5) — a repeated result
      // (e.g. rapid retries of the same action) must not stack clones
      setItems((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.msg === t.msg && last.kind === t.kind) return prev;
        // max ~4 visible: drop the oldest beyond the stack cap
        return [...prev.slice(-3), t];
      });
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 5000);
    };
    return () => {
      pushToast = null;
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] flex-col gap-2">
      {items.map((t) => (
        <ToastCard key={t.id} t={t} onClose={() => setItems((prev) => prev.filter((x) => x.id !== t.id))} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle — Win11: 40×20 pill, off #767676, on #0067C0
// ---------------------------------------------------------------------------

export function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-10 shrink-0 rounded-full transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none ${
        on ? "bg-[var(--accent-hex)]" : "bg-[#767676]"
      }`}
      style={{ boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)" }}
    >
      <span
        className={`absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-100 ${
          on ? "left-[26px]" : "left-1"
        }`}
      />
    </button>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal — Win11 dialog: acrylic backdrop, white card, bottom-right buttons
// ---------------------------------------------------------------------------

function focusableIn(root: HTMLElement): HTMLElement[] {
  // Note: no offsetParent filter — jsdom reports null for every element.
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "Confirm",
  danger,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // unique per instance so two modals can never share an aria-labelledby id
  const titleId = useId();

  // Focus trap + Escape (E2.4): focus moves in on open, Tab cycles within,
  // focus is restored to the opener on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const first = panel ? focusableIn(panel)[0] : undefined;
    // move focus in (after mount) — but never yank it back if the user has
    // already tabbed somewhere inside the dialog
    const t = window.setTimeout(() => {
      if (panel && first && !panel.contains(document.activeElement)) first.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && panel) {
        const els = focusableIn(panel);
        if (els.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[6px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-scale-in w-full max-w-md rounded-lg bg-[var(--surface-raised)] p-6"
        style={{ boxShadow: "var(--shadow-elevation-modal)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="mb-3 text-xl font-semibold text-[var(--text-primary)]">{title}</h3>
        <div className="mb-6 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={() => {
              onConfirm?.();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageHeader — Win11 Settings page title (28px semibold)
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// SettingRow — Win11 Settings row: label left, control right, 64px tall
// ---------------------------------------------------------------------------

export function SettingRow({
  title,
  description,
  control,
  onClick,
  disabled,
}: {
  title: string;
  description?: string;
  control?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      disabled={disabled}
      className={`setting-row w-full text-left ${onClick ? "hover:bg-[var(--surface-overlay)] disabled:opacity-40 disabled:pointer-events-none" : ""} ${onClick ? "px-2 -mx-2" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="setting-row-label">{title}</div>
        {description && <div className="setting-row-desc">{description}</div>}
      </div>
      {control && <div className="flex shrink-0 items-center">{control}</div>}
    </Comp>
  );
}

// ---------------------------------------------------------------------------
// InlineAlert — error/warning/info state banner (icon + clear messaging)
// ---------------------------------------------------------------------------

export function InlineAlert({
  kind = "error",
  children,
}: {
  kind?: "error" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  const styles: Record<string, { border: string; bg: string; color: string; Icon: typeof IconInfo }> = {
    error: { border: "var(--status-danger-border)", bg: "var(--status-danger-bg)", color: "var(--status-danger)", Icon: IconDanger },
    warning: { border: "var(--status-warning-border)", bg: "var(--status-warning-bg)", color: "var(--status-warning)", Icon: IconWarning },
    info: { border: "var(--status-info-border)", bg: "var(--status-info-bg)", color: "var(--status-info)", Icon: IconInfo },
    success: { border: "var(--status-success-border)", bg: "var(--status-success-bg)", color: "var(--status-success)", Icon: IconCheck },
  };
  const s = styles[kind];
  const Icon = s.Icon;
  return (
    <div className="flex items-start gap-2.5 rounded-md border px-4 py-3 text-sm" style={{ borderColor: s.border, background: s.bg, color: s.color }}>
      <Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select — Win11 combo box (custom dropdown, menu items 32px tall)
// ---------------------------------------------------------------------------

export function Select({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 min-w-[140px] items-center justify-between gap-3 rounded-[4px] border border-[#8A8A8A] bg-[var(--surface-base)] px-3 text-sm text-[var(--text-primary)] transition-colors duration-100 hover:border-[#5C5C5C] disabled:opacity-40 disabled:pointer-events-none"
      >
        <span className="truncate" title={current?.label ?? value}>{current?.label ?? value}</span>
        <IconChevronDown size={12} className="shrink-0 text-[var(--text-secondary)]" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1 min-w-full rounded-[4px] border border-[var(--border-default)] bg-[var(--surface-raised)] py-1"
          style={{ boxShadow: "var(--shadow-elevation-dropdown)" }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex h-8 w-full items-center px-3 text-left text-sm transition-colors duration-75 ${
                o.value === value
                  ? "bg-[var(--surface-selected)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreRing
// ---------------------------------------------------------------------------

export function ScoreRing({ score }: { score: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * c;
  const color =
    score >= 70 ? "var(--status-success)" : score >= 40 ? "var(--status-warning)" : "var(--status-danger)";
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-active)" strokeWidth="8" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-4xl font-semibold text-[var(--text-primary)]">{score}</div>
        <div className="text-xs text-[var(--text-tertiary)]">Health</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — Win11 widget card (white, 1px #E5E5E5, 8px radius, 16px padding)
// `bare` renders a page-level section header (20px) without a card.
// ---------------------------------------------------------------------------

export function Section({
  title,
  subtitle,
  children,
  actions,
  bare,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  bare?: boolean;
}) {
  if (bare) {
    return (
      <section className="pt-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="section-title">{title}</h2>
            {subtitle && <p className="section-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2 pb-1">{actions}</div>}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section className="card p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="widget-title">{title}</h2>
          {subtitle && <p className="widget-subtitle mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-[var(--text-tertiary)]">{icon}</span>}
        <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
      </div>
      <div className="mt-1 text-2xl font-semibold leading-tight" style={{ color: accent ?? "var(--text-primary)" }}>
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-[var(--text-tertiary)]" title={sub}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

export function Meter({
  value,
  max,
  color,
  height = 6,
}: {
  value: number;
  max: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="w-full overflow-hidden rounded-full bg-[var(--surface-active)]" style={{ height: `${height}px` }}>
      <div
        className="h-full rounded-full transition-all duration-100"
        style={{ width: `${pct}%`, background: color ?? "var(--accent-hex)" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress — determinate (accent) or Win11 indeterminate sliding bar
// ---------------------------------------------------------------------------

export function Progress({ value, max = 100, indeterminate = false }: { value?: number; max?: number; indeterminate?: boolean }) {
  if (indeterminate) return <div className="progress-indeterminate w-full" role="progressbar" aria-label="Loading" />;
  const pct = Math.min(100, Math.round(((value ?? 0) / Math.max(1, max)) * 100));
  return (
    <div className="progress w-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene preview (animated wallpaper thumbnail)
// ---------------------------------------------------------------------------

export function ScenePreview({
  kind,
  colors,
  speed = 1,
  density = 1,
  className = "",
}: {
  kind: string;
  colors: string[];
  speed?: number;
  density?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Palette parsed once per colors change — the effect keys off this stable
  // value so the hooks lint gate stays green without re-running the whole
  // animation on every render (colors is a fresh array each render).
  const col = useMemo(() => {
    const FALLBACK: [number, number, number][] = [
      [129, 140, 248],
      [56, 189, 248],
      [244, 114, 182],
    ];
    const hex = (h: string) => {
      const s = (h || "#818cf8").replace("#", "");
      return [
        parseInt(s.slice(0, 2), 16) || 129,
        parseInt(s.slice(2, 4), 16) || 140,
        parseInt(s.slice(4, 6), 16) || 248,
      ];
    };
    return colors.length ? colors.map(hex) : FALLBACK.map((c) => [...c]);
  }, [colors]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = (c.width = c.clientWidth);
    const H = (c.height = c.clientHeight);
    const FALLBACK: [number, number, number][] = [
      [129, 140, 248],
      [56, 189, 248],
      [244, 114, 182],
    ];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const rgba = (c: number[] | undefined, a: number) => {
      const cc = c ?? FALLBACK[0];
      return `rgba(${cc[0]},${cc[1]},${cc[2]},${a})`;
    };
    let t = 0;
    let raf = 0;
    let visible = true;
    // S13.2 — Win11 motion spec: with prefers-reduced-motion on, draw one
    // static frame and never schedule the next (scene previews freeze too).
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const TAU = Math.PI * 2;
    const N = Math.max(14, Math.floor(34 * density));
    const ps = Array.from({ length: N }, () => ({
      x: rnd(0, W),
      y: rnd(0, H),
      r: rnd(1, 2.6),
      vx: rnd(-0.4, 0.4) * speed,
      vy: rnd(-0.5, 0.2) * speed,
      a: rnd(0.3, 0.9),
      ph: rnd(0, TAU),
      c: col[rnd(0, col.length) | 0],
    }));
    const stars = Array.from({ length: Math.floor(60 * density) }, () => ({
      x: rnd(0, W),
      y: rnd(0, H),
      r: rnd(0.4, 1.4),
      tw: rnd(0.5, 2) * speed,
      ph: rnd(0, TAU),
    }));
    const draw = () => {
      t++;
      ctx.clearRect(0, 0, W, H);
      const pick = (i: number) => col[i % Math.max(1, col.length)];
      switch (kind) {
        case "particles":
          for (const p of ps) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.y < -6) {
              p.y = H + 6;
              p.x = rnd(0, W);
            }
            if (p.x < -6) p.x = W + 6;
            if (p.x > W + 6) p.x = -6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, TAU);
            ctx.fillStyle = rgba(p.c, p.a);
            ctx.fill();
          }
          break;
        case "waves": {
          for (let l = 0; l < 3; l++) {
            const amp = H * (0.08 + 0.03 * l),
              base = H * (0.55 + 0.18 * l);
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (let x = 0; x <= W; x += 6) {
              ctx.lineTo(x, base + Math.sin(x * 0.02 * (l + 1) + t * 0.05 * speed) * amp);
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fillStyle = rgba(pick(l), 0.3);
            ctx.fill();
          }
          break;
        }
        case "geometric":
          for (let y = -40; y < H + 40; y += 70) {
            for (let x = -40; x < W + 40; x += 70) {
              ctx.save();
              ctx.translate(x + Math.sin(t * 0.02 * speed + y * 0.05) * 12, y);
              ctx.rotate(t * 0.02 * speed + (x + y) * 0.004);
              ctx.beginPath();
              const sides = 3 + (((Math.round((x + y) / 100) % 3) + 3) % 3);
              for (let i = 0; i < sides; i++) {
                const a = (i / sides) * TAU;
                if (i === 0) ctx.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
                else ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
              }
              ctx.closePath();
              ctx.strokeStyle = rgba(pick(Math.round(x / 70) + Math.round(y / 70)), 0.5);
              ctx.lineWidth = 1.5;
              ctx.stroke();
              ctx.restore();
            }
          }
          break;
        case "parallax":
          for (let l = 0; l < 4; l++) {
            for (let i = 0; i < 6 + l * 3; i++) {
              const seed = (l * 100 + i) * 13.37;
              const px = ((seed * 7919) % 1000) / 1000;
              const x = (px * W + t * (0.2 + l * 0.1) * speed) % (W + 60) - 30;
              const y = ((seed * 3571) % 1000) / 1000;
              ctx.beginPath();
              ctx.arc(x, y * H, 4 + l * 3.4, 0, TAU);
              ctx.fillStyle = rgba(pick(l), 0.14 + l * 0.05);
              ctx.fill();
            }
          }
          break;
        case "aurora":
          for (let b = 0; b < 3; b++) {
            const bx = W * 0.3 + b * W * 0.2 + Math.sin(t * 0.02 * speed + b * 2) * W * 0.2;
            const by = H * 0.4 + Math.sin(t * 0.02 * speed + b) * 20;
            const g = ctx.createRadialGradient(bx, by, 0, bx, by, W * 0.4);
            g.addColorStop(0, rgba(pick(b), 0.2));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
          }
          break;
        case "stars":
          for (const s of stars) {
            const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.03 * s.tw + s.ph));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, TAU);
            ctx.fillStyle = rgba([226, 232, 240], tw);
            ctx.fill();
          }
          break;
        case "embers":
          for (const p of ps) {
            p.y -= 0.5 * speed;
            p.x += Math.sin(t * 0.05 + p.y) * 0.4;
            if (p.y < -6) {
              p.y = H + 6;
              p.x = rnd(0, W);
            }
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
            g.addColorStop(0, rgba(p.c, 0.8));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 3, 0, TAU);
            ctx.fill();
          }
          break;
        case "rain":
          ctx.fillStyle = "rgba(5,10,25,0.35)";
          ctx.fillRect(0, 0, W, H);
          ctx.lineCap = "round";
          for (const p of ps) {
            p.y += 4.5 * speed;
            if (p.y > H + 30) {
              p.y = -30;
              p.x = rnd(0, W);
            }
            ctx.strokeStyle = rgba(p.c, 0.7);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x, p.y + 12 * density);
            ctx.stroke();
          }
          break;
        case "fireflies":
          ctx.fillStyle = "#0a1220";
          ctx.fillRect(0, 0, W, H);
          for (const p of ps) {
            // homex/homey are set lazily on first frame (fireflies wander near home)
            const f = p as { x: number; y: number; r: number; vx: number; vy: number; ph: number; c: number[]; homex?: number; homey?: number };
            f.homex = f.homex ?? f.x;
            f.homey = f.homey ?? f.y;
            f.x += (f.homex - f.x) * 0.002 + (f.vx ?? 0.1);
            f.y += (f.homey - f.y) * 0.002 + (f.vy ?? 0.05);
            const a = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.05 + f.ph));
            const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 4);
            g.addColorStop(0, rgba(f.c, a));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r * 4, 0, TAU);
            ctx.fill();
          }
          break;
        case "snowfall-wind":
          ctx.clearRect(0, 0, W, H);
          for (const p of ps) {
            p.x += Math.sin(t * 0.03 + p.ph) * 0.8 * speed;
            p.y += 0.9 * speed;
            if (p.y > H + 6) {
              p.y = -6;
              p.x = rnd(0, W);
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, TAU);
            ctx.fillStyle = rgba(p.c, 0.7);
            ctx.fill();
          }
          break;
        case "bokeh":
          ctx.fillStyle = "#070a18";
          ctx.fillRect(0, 0, W, H);
          for (const p of ps) {
            p.y -= 0.2 * speed;
            p.x += Math.sin(t * 0.008 + p.ph) * 0.4;
            if (p.y < -80) {
              p.y = H + 80;
              p.x = rnd(0, W);
            }
            const r = p.r * 12;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, rgba(p.c, 0.12));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.fill();
          }
          break;
        case "smoke":
          ctx.fillStyle = "rgba(10,8,16,0.08)";
          ctx.fillRect(0, 0, W, H);
          for (const p of ps) {
            p.y -= 0.3 * speed;
            p.x += Math.sin(t * 0.02 + p.ph) * 0.3;
            if (p.y < -40) {
              p.y = H + rnd(0, H * 0.3);
              p.x = rnd(0, W);
            }
            const r = p.r * (1 + ((t * 0.01) % 2));
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, rgba(p.c, 0.14));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, TAU);
            ctx.fill();
          }
          break;
        case "waves-3d":
          ctx.fillStyle = "#04070f";
          ctx.fillRect(0, 0, W, H);
          for (let l = 4; l >= 0; l--) {
            const depth = 1 - l / 5;
            const amp = H * (0.03 + depth * 0.09);
            const base = H * (0.35 + l * 0.14);
            const f = 0.002 * (l + 1) * speed;
            const ph = t * 0.03 + l * 1.7;
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (let x = -20; x <= W + 20; x += 6) {
              const y = base + Math.sin(x * f + ph) * amp * (1 + depth);
              ctx.lineTo(x, y);
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fillStyle = rgba(pick(l), 0.1 + depth * 0.22);
            ctx.fill();
          }
          break;
      }
      if (visible && !reduceMotion) raf = requestAnimationFrame(draw);
    };
    // Only animate while on screen (B17/A3.3) — canvas previews otherwise
    // burn rAF cycles forever even scrolled out of view.
    const io = new IntersectionObserver(
      ([e]) => {
        const on = e.isIntersecting;
        if (on && !visible) {
          visible = true;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        } else if (!on && visible) {
          visible = false;
          cancelAnimationFrame(raf);
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(c);
    draw();
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [kind, col, speed, density]);
  return <canvas ref={ref} className={className} />;
}

// ---------------------------------------------------------------------------
// KindChip
// ---------------------------------------------------------------------------

// Exported for the K9 parity test — the style set must equal the canonical
// undo-kind list (src/lib/undo-kinds.ts), enforced by both this test and
// scripts/check-kind-parity.mjs.
export const KIND_CHIP_STYLES: Record<string, string> = {
  accent: "badge-accent",
  accessibility: "badge badge-info",
  mode: "badge badge-warning",
  transparency: "badge badge-info",
  wallpaper: "badge badge-success",
  junk_clean: "badge badge-danger",
  startup_disable: "badge badge-warning",
  startup_folder_disable: "badge badge-warning",
  snapshot: "badge badge-neutral",
  animated_wallpaper: "badge badge-accent",
  animated_wallpaper_stop: "badge badge-neutral",
  video_wallpaper: "badge badge-accent",
  video_wallpaper_stop: "badge badge-neutral",
  taskbar_size: "badge badge-neutral",
  taskbar_alignment: "badge badge-neutral",
  taskbar_autohide: "badge badge-neutral",
  taskbar_color_match: "badge badge-neutral",
  taskbar_position: "badge badge-neutral",
  sound_scheme: "badge badge-info",
  sound_event: "badge badge-info",
  font_substitution: "badge badge-neutral",
  font_install: "badge badge-success",
  font_uninstall: "badge badge-warning",
  focus_session: "badge badge-accent",
  lock_screen: "badge badge-info",
  style_applied: "badge badge-accent",
  marketplace_apply: "badge badge-accent",
  macro_fired: "badge badge-info",
  custom_scene_saved: "badge badge-accent",
  custom_scene_deleted: "badge badge-neutral",
  game_profile: "badge badge-info",
  power: "badge badge-warning",
  widget_layout: "badge badge-neutral",
  rgb_color: "badge badge-accent",
  scan: "badge badge-info",
  definitions_update: "badge badge-success",
  asr_rule: "badge badge-warning",
  cfa: "badge badge-warning",
  rt_disable: "badge badge-danger",
  rt_reenable: "badge badge-success",
  threat_remove: "badge badge-danger",
  threat_restore: "badge badge-success",
  scheduled_maintenance: "badge badge-neutral",
  shell_restart: "badge badge-warning",
  permission: "badge badge-info",
  browser_policy: "badge badge-neutral",
  game_mode: "badge badge-accent",
  stream_layout: "badge badge-neutral",
  display_profile: "badge badge-neutral",
  network_reset: "badge badge-danger",
  wifi_forgot: "badge badge-warning",
  vpn_connect: "badge badge-success",
  vpn_disconnect: "badge badge-neutral",
  wallpaper_slideshow: "badge badge-info",
  macro: "badge badge-neutral",
  focus_mode: "badge badge-accent",
  blue_light: "badge badge-info",

  power_plan: "badge badge-neutral",
  process_ended: "badge badge-danger",
  registry_cleanup: "badge badge-warning",
  file_association: "badge badge-neutral",
  uninstall: "badge badge-danger",
  duplicates_removed: "badge badge-warning",
  trash_emptied: "badge badge-danger",
  sort: "badge badge-neutral",
  archive: "badge badge-neutral",
  rename: "badge badge-neutral",
  downloads_expired: "badge badge-warning",
  cursors: "badge badge-neutral",
  storage_clean: "badge badge-success",
  // stale kinds that Rust no longer logs were removed (K9 parity) — see
  // src/lib/undo-kinds.ts for the canonical set and scripts/check-kind-parity.mjs
};

export function KindChip({ kind }: { kind: string }) {
  const cls = KIND_CHIP_STYLES[kind] ?? "badge badge-neutral";
  return <span className={`shrink-0 ${cls}`}>{kind.replace(/_/g, " ")}</span>;
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="mb-3 text-2xl text-[var(--text-tertiary)]">{icon}</div>}
      <div className="text-sm text-[var(--text-secondary)]">{title}</div>
      {description && <div className="mt-1 text-xs text-[var(--text-tertiary)]">{description}</div>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

export function StatusDot({
  status,
  pulse = false,
}: {
  status: "success" | "warning" | "danger" | "info" | "neutral";
  pulse?: boolean;
}) {
  const colors: Record<string, string> = {
    success: "bg-[var(--status-success)]",
    warning: "bg-[var(--status-warning)]",
    danger: "bg-[var(--status-danger)]",
    info: "bg-[var(--status-info)]",
    neutral: "bg-[var(--text-tertiary)]",
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${colors[status]}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colors[status]}`} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

// ---------------------------------------------------------------------------
// SearchBox — Win11 Settings search input
// ---------------------------------------------------------------------------

export function SearchBox({
  value,
  onChange,
  placeholder = "Find a setting",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <IconSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-[4px] border border-[#8A8A8A] bg-[var(--surface-base)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)] transition-colors duration-100 hover:border-[#5C5C5C] focus:border-[var(--border-focus)]"
      />
    </div>
  );
}
