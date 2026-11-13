/** Server-rendered animated shapes: hero aurora, sparkline, progress ring, live dot, ticker. */
import type { CSSProperties, ReactNode } from "react";

/** Style for the n-th element of a cascade (cards rising in one after another). */
export const rise = (i: number): { className: string; style: CSSProperties } => ({ className: "motion-rise", style: { ["--i" as string]: i } as CSSProperties });

/** Gradient hero band with drifting colour blobs. */
export function Aurora({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`@container motion-aurora hero-band motion-sheen rounded-2xl p-6 shadow-lg sm:p-8 ${className}`} data-testid="hero">
      <span className="aurora-blob a" aria-hidden /><span className="aurora-blob b" aria-hidden /><span className="aurora-blob c" aria-hidden /><span className="aurora-blob d" aria-hidden />
      {children}
    </section>
  );
}

/** Small trend line that draws itself, with a soft area and a pulsing last point. */
export function Sparkline({ values, label, color = "var(--vivid-blue)", height = 56, className = "" }: { values: number[]; label: string; color?: string; height?: number; className?: string }) {
  const w = 200, h = height, pad = 4;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const x = (i: number) => (values.length < 2 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2));
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`;
  const id = `sg${Math.abs(label.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 1e6}`;
  const last = values.length - 1;
  return (
    <div className={`relative ${className}`} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {values.length > 1 && <path d={area} fill={`url(#${id})`} className="motion-fade-late" />}
        {values.length > 1 && <path d={line} pathLength={1} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="motion-draw" />}
      </svg>
      {last >= 0 && (
        <span className="motion-fade-late absolute size-2.5 -translate-x-1/2 -translate-y-1/2" style={{ left: `${(x(last) / w) * 100}%`, top: `${(y(values[last]) / h) * 100}%` }} aria-hidden>
          <span className="motion-ping absolute inset-0 rounded-full" style={{ background: color }} /><span className="absolute inset-0 rounded-full ring-2 ring-white" style={{ background: color }} />
        </span>
      )}
    </div>
  );
}

/** Ring that fills to `value` (0–1) with a gradient stroke; children sit in the middle. */
export function ProgressRing({ value, size = 96, stroke = 10, label, children, from = "var(--vivid-teal)", to = "var(--vivid-blue)" }: { value: number; size?: number; stroke?: number; label: string; children?: ReactNode; from?: string; to?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const id = `rg${Math.round(v * 1000)}${size}`;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs><linearGradient id={id}><stop offset="0%" stopColor={from} /><stop offset="100%" stopColor={to} /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round" pathLength={100}
          className="motion-ring" style={{ ["--ring-to" as string]: 100 - v * 100, strokeDashoffset: 100 - v * 100 } as CSSProperties} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** "Live" dot with a ping. */
export function LiveDot({ color = "var(--vivid-lime)", label }: { color?: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex size-2.5" aria-hidden>
        <span className="motion-ping absolute inset-0 rounded-full" style={{ background: color }} />
        <span className="relative inline-flex size-2.5 rounded-full" style={{ background: color }} />
      </span>
      {label && <span className="text-xs font-medium uppercase tracking-wide">{label}</span>}
    </span>
  );
}

/** Endless horizontal ticker (pauses on hover; a plain scrollable row for reduced motion). */
export function Ticker({ items, label, seconds = 45 }: { items: ReactNode[]; label: string; seconds?: number }) {
  if (!items.length) return null;
  const row = (hidden: boolean) => <div className="flex shrink-0 gap-3 pr-3" aria-hidden={hidden || undefined}>{items.map((it, i) => <div key={i} className="shrink-0">{it}</div>)}</div>;
  return (
    <div className="motion-ticker" aria-label={label} data-testid="ticker">
      <div className="motion-ticker-track" style={{ ["--ticker-s" as string]: `${seconds}s` } as CSSProperties}>{row(false)}{row(true)}</div>
    </div>
  );
}
