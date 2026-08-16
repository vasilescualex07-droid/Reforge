export function Sparkline({ data, color, height = 64, maxOverride }: { data: number[]; color: string; height?: number; maxOverride?: number }) {
  if (data.length < 2) {
    return <div className="flex h-16 items-center justify-center text-sm text-[var(--text-tertiary)]">collecting…</div>;
  }
  const w = 100;
  const max = maxOverride ?? Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const area = `0,${height} ${pts.join(" ")} ${w},${height}`;
  const last = data[data.length - 1];
  const lastY = height - ((last - min) / range) * (height - 6) - 3;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-16 w-full">
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={w} cy={lastY} r="2.2" fill={color} />
    </svg>
  );
}

export function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
