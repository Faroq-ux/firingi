"use client";
/**
 * Demand forecast chart (Phase 30). One axis (units per week). Sales so far: solid line; forecast:
 * dashed line in the same colour with its 80 % range as a light band; earlier frozen forecasts for
 * the weeks that already happened: hollow dots (how good the forecast was); weeks with a demand event:
 * shaded and labelled. A "now" divider separates the past from the future. Crosshair + tooltip.
 */
import * as React from "react";

export type ForecastPoint = { t: number; actual?: number | null; forecast?: number | null; low?: number | null; high?: number | null; past?: number | null; event?: string | null };
export type ForecastLabels = { actual: string; forecast: string; range: string; past: string; now: string; units: string; event: string };

function niceStep(v: number) {
  if (v <= 0) return 1;
  const raw = v / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function ForecastChart({ points, labels, locale = "en", height = 280, testId, ariaLabel }: { points: ForecastPoint[]; labels: ForecastLabels; locale?: string; height?: number; testId?: string; ariaLabel: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!ref.current) return;
    setWidth(Math.max(280, Math.floor(ref.current.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const n = points.length;
  const m = { l: 44, r: 12, t: 12, b: 26 };
  const iw = Math.max(1, width - m.l - m.r), ih = height - m.t - m.b;
  const vals = points.flatMap((p) => [p.actual, p.forecast, p.high, p.past]).filter((v): v is number => typeof v === "number");
  const step = niceStep(Math.max(1, ...vals));
  const hi = Math.max(step, Math.ceil(Math.max(0, ...vals) / step) * step);
  const band = iw / Math.max(1, n);
  const x = (i: number) => m.l + band * (i + 0.5);
  const y = (v: number) => m.t + ih - (v / hi) * ih;
  const ticks: number[] = []; for (let v = 0; v <= hi + 1e-9; v += step) ticks.push(v);
  const nowIdx = points.findIndex((p) => p.forecast != null);
  const num = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
  const date = (t: number, long = false) => new Intl.DateTimeFormat(locale, long ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }).format(new Date(t));
  const line = (key: "actual" | "forecast") => {
    let d = "", open = false;
    points.forEach((p, i) => { const v = p[key]; if (v == null) { open = false; return; } d += `${open ? "L" : "M"}${x(i)},${y(v)}`; open = true; });
    return d;
  };
  // forecast starts from the last actual so the two lines join
  const lastActual = nowIdx > 0 ? points[nowIdx - 1]?.actual : null;
  const joined = nowIdx > 0 && lastActual != null && points[nowIdx].forecast != null ? `M${x(nowIdx - 1)},${y(lastActual)}L${x(nowIdx)},${y(points[nowIdx].forecast!)}` : "";
  const area = (() => {
    const idx = points.map((p, i) => (p.low != null && p.high != null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return "";
    return `M${idx.map((i) => `${x(i)},${y(points[i].high!)}`).join("L")}L${[...idx].reverse().map((i) => `${x(i)},${y(points[i].low!)}`).join("L")}Z`;
  })();
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative w-full" data-testid={testId}>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="inline-block w-4 rounded" style={{ background: "var(--series-1)", height: 3 }} aria-hidden />{labels.actual}</li>
        {points.some((p) => p.forecast != null) && <li className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-[3px] border-dashed" style={{ borderColor: "var(--series-1)" }} aria-hidden />{labels.forecast}</li>}
        {points.some((p) => p.low != null) && <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "color-mix(in srgb, var(--series-1) 18%, transparent)" }} aria-hidden />{labels.range}</li>}
        {points.some((p) => p.past != null) && <li className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full border-2" style={{ borderColor: "var(--series-2)" }} aria-hidden />{labels.past}</li>}
        {points.some((p) => p.event) && <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-muted" aria-hidden />{labels.event}</li>}
      </ul>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block touch-none select-none"
          onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - m.l) / band); setHover(i >= 0 && i < n ? i : null); }}
          onPointerLeave={() => setHover(null)}>
          {points.map((p, i) => p.event ? <rect key={`e${i}`} x={m.l + band * i} y={m.t} width={band} height={ih} className="fill-muted" opacity={0.7} /> : null)}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={m.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{num(v)}</text>
            </g>
          ))}
          {points.map((p, i) => (i % every === 0 ? <text key={`x${i}`} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">{date(p.t)}</text> : null))}
          <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} stroke="var(--chart-axis)" strokeWidth={1} />
          {nowIdx > 0 && (
            <g>
              <line x1={m.l + band * nowIdx} x2={m.l + band * nowIdx} y1={m.t} y2={m.t + ih} stroke="var(--chart-axis)" strokeDasharray="2 3" />
              <text x={m.l + band * nowIdx + 4} y={m.t + 10} className="fill-muted-foreground text-[10px] uppercase tracking-wide">{labels.now}</text>
            </g>
          )}
          {area && <path d={area} fill="color-mix(in srgb, var(--series-1) 18%, transparent)" />}
          <path d={line("actual")} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {joined && <path d={joined} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" />}
          <path d={line("forecast")} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
          {points.map((p, i) => (p.past != null ? <circle key={`p${i}`} cx={x(i)} cy={y(p.past)} r={4} fill="var(--card)" stroke="var(--series-2)" strokeWidth={2} /> : null))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--chart-axis)" strokeDasharray="3 3" />}
          {hp && hp.actual != null && <circle cx={x(hover!)} cy={y(hp.actual)} r={4} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />}
          {hp && hp.forecast != null && <circle cx={x(hover!)} cy={y(hp.forecast)} r={4} fill="var(--card)" stroke="var(--series-1)" strokeWidth={2} />}
        </svg>
      )}
      {hp && (
        <div className="pointer-events-none absolute top-8 z-10 min-w-44 rounded-lg border bg-popover/95 p-2 text-xs shadow-lg backdrop-blur" style={{ left: Math.min(x(hover!) + 12, Math.max(0, width - 200)) }} role="status">
          <p className="mb-1 font-medium">{date(hp.t, true)}</p>
          {hp.actual != null && <p className="flex justify-between gap-3"><span>{labels.actual}</span><span className="tabular-nums">{num(hp.actual)} {labels.units}</span></p>}
          {hp.past != null && <p className="flex justify-between gap-3"><span>{labels.past}</span><span className="tabular-nums">{num(hp.past)}</span></p>}
          {hp.forecast != null && <p className="flex justify-between gap-3"><span>{labels.forecast}</span><span className="tabular-nums">{num(hp.forecast)} {labels.units}</span></p>}
          {hp.low != null && hp.high != null && <p className="flex justify-between gap-3 text-muted-foreground"><span>{labels.range}</span><span className="tabular-nums">{num(hp.low)}–{num(hp.high)}</span></p>}
          {hp.event && <p className="mt-1 text-muted-foreground">{hp.event}</p>}
        </div>
      )}
    </div>
  );
}

/** Forecast vs. actual per week (accuracy), two series on one axis. */
export function AccuracyChart({ weeks, labels, locale = "en", height = 220, testId }: { weeks: { week: string; qty: number; actual: number }[]; labels: { forecast: string; actual: string; units: string }; locale?: string; height?: number; testId?: string }) {
  const pts: ForecastPoint[] = weeks.map((w) => ({ t: new Date(`${w.week}T00:00:00Z`).getTime(), actual: w.actual, past: w.qty }));
  return <ForecastChart points={pts} height={height} locale={locale} testId={testId} ariaLabel={`${labels.forecast} / ${labels.actual}`} labels={{ actual: labels.actual, forecast: labels.forecast, range: "", past: labels.forecast, now: "", units: labels.units, event: "" }} />;
}
