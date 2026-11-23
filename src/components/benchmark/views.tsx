/** Price benchmark (Phase 70) — server-rendered bits: the range bar and money formatting. */
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
export const eur = (locale: string, n: number, digits = 2) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) }).format(n);
export const unitEur = (locale: string, n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);

/**
 * The spread of what similar buyers pay (p10…p90 track, p25…p75 band, median tick) and where a price sits (dot).
 * Accessible: an aria-label carries the same numbers.
 */
export function RangeBar({ s, value, label, tone = "auto" }: { s: { p10: number; p25: number; p50: number; p75: number; p90: number }; value: number; label: string; tone?: "auto" | "neutral" }) {
  const lo = Math.min(s.p10, value) * 0.97, hi = Math.max(s.p90, value) * 1.03, w = hi - lo || 1;
  const x = (v: number) => `${((v - lo) / w) * 100}%`;
  const color = tone === "neutral" ? "bg-foreground" : value > s.p50 * 1.03 ? "bg-destructive" : value < s.p50 * 0.97 ? "bg-[color:var(--success,#16a34a)]" : "bg-primary";
  return (
    <div className="relative h-5 w-full min-w-32" role="img" aria-label={label} data-testid="bm-range">
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" style={{ left: x(s.p10), width: `calc(${x(s.p90)} - ${x(s.p10)})` }} />
      <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-primary/25" style={{ left: x(s.p25), width: `calc(${x(s.p75)} - ${x(s.p25)})` }} />
      <div className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-foreground/60" style={{ left: x(s.p50) }} />
      <div className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${color}`} style={{ left: x(value) }} />
    </div>
  );
}
