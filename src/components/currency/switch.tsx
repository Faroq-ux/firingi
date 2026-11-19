import Link from "next/link";
import { LOCAL_CURRENCIES } from "@/lib/currency";

/** Phase 45: FIRINGI reports — show the amounts in EUR (default) or another currency at today's reference rate. */
export function CurrencySwitch({ current, params, path = "", note }: { current: string; params: Record<string, string>; path?: string; note?: string | null }) {
  const href = (code: string) => {
    const u = new URLSearchParams({ ...params });
    if (code === "EUR") u.delete("ccy"); else u.set("ccy", code);
    const s = u.toString();
    return `${path}${s ? `?${s}` : "?"}`;
  };
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-1.5 text-xs" data-testid="currency-switch">
      <span className="mr-1 font-medium text-muted-foreground">Currency</span>
      {["EUR", ...LOCAL_CURRENCIES].map((c) => (
        <Link key={c} href={href(c)} scroll={false} aria-current={c === current ? "true" : undefined}
          className={`rounded-full border px-2.5 py-0.5 tabular-nums transition-colors ${c === current ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{c}</Link>
      ))}
      {note && <span className="ml-1 text-muted-foreground">{note}</span>}
    </div>
  );
}

/** A small line of a rate's last days (scaled to its own min–max). */
export function RateSpark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 112, h = 28, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="max-w-full">
      <polyline points={pts} fill="none" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" stroke={up ? "var(--vivid-teal, #0d9488)" : "var(--vivid-pink, #db2777)"} />
    </svg>
  );
}
