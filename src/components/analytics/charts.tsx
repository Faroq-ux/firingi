"use client";
/**
 * Dependency-free charts for the reports. Rules: one y-axis, ≤ 3 series in the fixed
 * categorical order (--series-1..3), 2px lines, bars ≤ 24px with a 4px rounded data end,
 * hairline grid, crosshair + tooltip on hover, legend for 2+ series, and a table view
 * so nothing relies on colour alone. Text never takes the series colour.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export { fmtPeriod, fmtValue, type Fmt } from "@/lib/analytics-format";
import { fmtPeriod, fmtValue, type Fmt } from "@/lib/analytics-format";
export type Series = { key: string; label: string; values: number[] };
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

/** Round tick step (1, 2 or 5 × 10ⁿ) giving about four intervals. */
function niceStep(v: number) {
  if (v <= 0) return 1;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    if (!ref.current) return;
    setW(Math.max(240, Math.floor(ref.current.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Legend({ series }: { series: { label: string }[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Time series — lines (default) or columns. Series share one axis and one unit. */
export function TimeChart({ points, grain, series, fmt, locale, kind = "line", height = 240, testId }: {
  points: string[]; grain: "day" | "week" | "month"; series: Series[]; fmt: Fmt; locale: string; kind?: "line" | "bar"; height?: number; testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const S = series.slice(0, 3);
  const n = points.length;
  const m = { l: 60, r: 12, t: 10, b: 26 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const all = S.flatMap((s) => s.values);
  const rawLo = Math.min(0, ...all);
  const rawHi = Math.max(0, ...all);
  const step = niceStep(rawHi - rawLo);
  const hi = Math.max(step, Math.ceil(rawHi / step) * step);
  const y0 = rawLo < 0 ? -Math.ceil(-rawLo / step) * step : 0;
  const span = hi - y0;
  const y = (v: number) => m.t + ih - ((v - y0) / (span || 1)) * ih;
  const band = iw / Math.max(1, n);
  const x = (i: number) => (kind === "bar" ? m.l + band * i + band / 2 : m.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1)));
  const ticks = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => y0 + step * i);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 80))));
  const barW = Math.max(2, Math.min(24, (band * 0.7) / S.length - 2));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = kind === "bar" ? Math.floor(px / band) : Math.round(n <= 1 ? 0 : (px / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  if (!n) return <div ref={ref} className="flex h-40 items-center justify-center text-sm text-muted-foreground">—</div>;
  // Drawn after mount: it needs the measured width, and server/browser number formats can differ.
  if (!width) return <div ref={ref} className="w-full" style={{ height: height + (S.length > 1 ? 24 : 0) }} data-testid={testId} />;
  return (
    <div ref={ref} className="relative w-full" data-testid={testId}>
      <Legend series={S} />
      <svg width={width} height={height} role="img" aria-label={S.map((s) => s.label).join(", ")} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{fmtValue(t, fmt, locale, true)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % every === 0 ? (
          <text key={p} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">{fmtPeriod(p, grain, locale)}</text>
        ) : null))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--chart-axis)" strokeWidth={1} shapeRendering="crispEdges" />}
        {kind === "bar"
          ? S.map((s, si) => s.values.map((v, i) => {
              const cx = x(i) - (S.length * (barW + 2)) / 2 + si * (barW + 2) + 1;
              const top = y(Math.max(v, 0));
              const h = Math.max(0, Math.abs(y(v) - y(0)));
              const r = Math.min(4, h, barW / 2);
              const d = v >= 0
                ? `M${cx},${top + h} V${top + r} Q${cx},${top} ${cx + r},${top} H${cx + barW - r} Q${cx + barW},${top} ${cx + barW},${top + r} V${top + h} Z`
                : `M${cx},${y(0)} V${y(v) - r} Q${cx},${y(v)} ${cx + r},${y(v)} H${cx + barW - r} Q${cx + barW},${y(v)} ${cx + barW},${y(v) - r} V${y(0)} Z`;
              return <path key={`${s.key}-${i}`} d={d} fill={SERIES[si]} opacity={hover === null || hover === i ? 1 : 0.55} className="motion-grow-y" style={{ ["--i" as string]: i } as React.CSSProperties} />;
            }))
          : S.map((s, si) => (
              <g key={s.key}>
                {si === 0 && n > 1 && (
                  <path className="motion-fade-late" fill={SERIES[0]} opacity={0.1}
                    d={`${s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} L${x(n - 1)},${y(Math.max(0, y0))} L${x(0)},${y(Math.max(0, y0))} Z`} />
                )}
                <path d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} pathLength={1} className="motion-draw" fill="none" stroke={SERIES[si]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {(n === 1 || hover !== null) && (
                  <circle cx={x(hover ?? 0)} cy={y(s.values[hover ?? 0])} r={4} fill={SERIES[si]} stroke="var(--card)" strokeWidth={2} />
                )}
              </g>
            ))}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-md border px-3 py-2 text-xs shadow-md"
          style={{ left: Math.min(x(hover) + 12, width - 170), top: 24, background: "var(--card)" }}
          role="status"
          data-testid="chart-tooltip"
        >
          <div className="mb-1 font-medium">{fmtPeriod(points[hover], grain, locale)}</div>
          {S.map((s, si) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES[si] }} />{s.label}</span>
              <span className="tabular-nums">{fmtValue(s.values[hover], fmt, locale)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars (top N). Value and share are shown as text next to the bar. */
export function BarList({ rows, fmt, locale, testId, emptyText = "—" }: {
  rows: { key: string; label: string; value: number; href?: string; hint?: string }[]; fmt: Fmt; locale: string; testId?: string; emptyText?: string;
}) {
  const [hover, setHover] = React.useState<string | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground" data-testid={testId}>{emptyText}</p>;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {rows.map((r, ri) => {
        const pct = max > 0 ? Math.max(0, r.value) / max : 0;
        const label = r.href ? <a href={r.href} className="hover:underline">{r.label}</a> : r.label;
        return (
          <li key={r.key} className="group" onPointerEnter={() => setHover(r.key)} onPointerLeave={() => setHover(null)}>
            <div className="mb-0.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{label}{r.hint && <span className="ml-1.5 text-xs text-muted-foreground">{r.hint}</span>}</span>
              <span className="shrink-0 tabular-nums" suppressHydrationWarning>
                {fmtValue(r.value, fmt, locale)}
                <span className={cn("ml-1.5 text-xs text-muted-foreground", hover === r.key ? "inline" : "hidden sm:inline")} suppressHydrationWarning>{total > 0 ? fmtValue(Math.max(0, r.value) / total, "percent", locale) : ""}</span>
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-[color-mix(in_oklch,var(--vivid-blue)_8%,transparent)]">
              <div className="motion-grow-x h-3 rounded-full transition-opacity" style={{ width: `${Math.max(pct * 100, r.value > 0 ? 0.5 : 0)}%`, background: `linear-gradient(90deg, ${SERIES[0]}, color-mix(in oklch, ${SERIES[0]} 55%, var(--vivid-violet)))`, opacity: hover && hover !== r.key ? 0.55 : 1, ["--i" as string]: ri } as React.CSSProperties} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Card with a Chart / Table switch — the table is the accessible twin of the chart. */
export function ChartCard({ title, description, table, children, labels, actions, className }: {
  title: string; description?: string; table?: { head: string[]; rows: string[][]; align?: ("left" | "right")[] }; children: React.ReactNode;
  labels?: { chart: string; table: string }; actions?: React.ReactNode; className?: string;
}) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const L = labels ?? { chart: "Chart", table: "Table" };
  return (
    <section className={cn("tile motion-rise motion-lift rounded-xl border bg-card p-4", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[color:color-mix(in_oklch,var(--vivid-blue)_75%,var(--foreground))]">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {table && (
            <div className="inline-flex rounded-md border p-0.5 text-xs" role="tablist">
              {(["chart", "table"] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cn("rounded px-2 py-0.5", view === v ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
                  {L[v]}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      {view === "chart" || !table ? children : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b">{table.head.map((h, i) => <th key={h} className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", table.align?.[i] === "right" ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, ri) => <tr key={ri} className="border-b last:border-0">{r.map((c, i) => <td key={i} className={cn("px-2 py-1.5", table.align?.[i] === "right" ? "text-right tabular-nums" : "")}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
