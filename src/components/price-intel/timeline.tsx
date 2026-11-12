"use client";
/**
 * Price timeline (Phase 29): one step line per supplier (prices hold until they change), one axis
 * (€ per unit), fixed categorical colours (series-1…8, never cycled — more suppliers fold into the
 * table below the chart), legend above, crosshair + tooltip with every supplier's price at that moment.
 */
import * as React from "react";

export type TimelineSeries = { key: string; label: string; points: { t: number; v: number | null }[] };
const COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

function niceStep(v: number) {
  if (v <= 0) return 1;
  const raw = v / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const levelAt = (pts: TimelineSeries["points"], t: number) => { let v: number | null = null; for (const p of pts) { if (p.t > t) break; v = p.v; } return v; };

export function PriceTimeline({ series, from, to, locale = "en", height = 300, label, testId }: { series: TimelineSeries[]; from: number; to: number; locale?: string; height?: number; label: string; testId?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!ref.current) return;
    setWidth(Math.max(260, Math.floor(ref.current.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const S = series.slice(0, 8);
  const money = (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v);
  const m = { l: 64, r: 14, t: 10, b: 28 };
  const iw = Math.max(1, width - m.l - m.r), ih = height - m.t - m.b;
  const vals = S.flatMap((s) => s.points.map((p) => p.v)).filter((v): v is number => v !== null);
  const lo0 = vals.length ? Math.min(...vals) : 0, hi0 = vals.length ? Math.max(...vals) : 1;
  const step = niceStep((hi0 - lo0) || hi0 || 1);
  const lo = Math.max(0, Math.floor((lo0 - step * 0.5) / step) * step), hi = Math.ceil((hi0 + step * 0.5) / step) * step;
  const x = (t: number) => m.l + ((t - from) / Math.max(1, to - from)) * iw;
  const y = (v: number) => m.t + ih - ((v - lo) / Math.max(1e-9, hi - lo)) * ih;
  const ticks: number[] = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const months: number[] = [];
  { const d = new Date(from); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (d.getTime() < to) { months.push(d.getTime()); d.setUTCMonth(d.getUTCMonth() + 1); } }
  const path = (pts: TimelineSeries["points"]) => {
    let d = "", prev: { t: number; v: number | null } | null = null;
    for (const p of pts) {
      if (p.v === null) { prev = p; continue; }
      if (!prev || prev.v === null) d += `M${x(p.t)},${y(p.v)}`;
      else d += `H${x(p.t)}V${y(p.v)}`;
      prev = p;
    }
    return d;
  };
  const hoverT = hover === null ? null : from + ((hover - m.l) / iw) * (to - from);
  const fmtDate = (t: number) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(t));
  return (
    <div ref={ref} className="relative w-full" data-testid={testId}>
      {S.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {S.map((s, i) => <li key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: COLORS[i], height: 3 }} aria-hidden />{s.label}</li>)}
        </ul>
      )}
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block touch-none select-none"
          onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = e.clientX - r.left; setHover(px >= m.l && px <= m.l + iw ? px : null); }}
          onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{money(v)}</text>
            </g>
          ))}
          {months.map((t) => <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">{new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(t))}</text>)}
          <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} stroke="var(--chart-axis)" strokeWidth={1} />
          {S.map((s, i) => (
            <g key={s.key}>
              <path d={path(s.points)} fill="none" stroke={COLORS[i]} strokeWidth={2} strokeLinejoin="round" />
              {s.points.slice(1, -1).filter((p) => p.v !== null).map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.v!)} r={4} fill={COLORS[i]} stroke="var(--card)" strokeWidth={2} />)}
            </g>
          ))}
          {hover !== null && <line x1={hover} x2={hover} y1={m.t} y2={m.t + ih} stroke="var(--chart-axis)" strokeDasharray="3 3" />}
        </svg>
      )}
      {hover !== null && hoverT !== null && (
        <div className="pointer-events-none absolute top-8 z-10 min-w-44 rounded-lg border bg-popover/95 p-2 text-xs shadow-lg backdrop-blur" style={{ left: Math.min(hover + 12, Math.max(0, width - 200)) }} role="status">
          <p className="mb-1 font-medium">{fmtDate(hoverT)}</p>
          {S.map((s, i) => { const v = levelAt(s.points, hoverT); return <p key={s.key} className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: COLORS[i] }} /><span className="flex-1 truncate">{s.label}</span><span className="tabular-nums">{v === null ? "—" : money(v)}</span></p>; })}
        </div>
      )}
    </div>
  );
}
