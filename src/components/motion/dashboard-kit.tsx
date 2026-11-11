/** Dashboard pieces: glass hero stats, vivid tiles, order ticker chips, top-N bars. */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "./count-up";
import { Ticker } from "./shapes";
import type { Fmt } from "@/lib/analytics-format";
import { formatMoney } from "@/lib/utils";

/** White stat on the coloured hero (frosted glass). */
export function HeroStat({ label, value, fmt = "int", locale, href, sub, i = 0 }: { label: string; value: number; fmt?: Fmt | "int"; locale: string; href?: string; sub?: ReactNode; i?: number }) {
  const body = (
    <div className="glass motion-rise rounded-xl p-3 transition-transform hover:-translate-y-0.5" style={{ ["--i" as string]: i + 2 } as CSSProperties}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{label}</div>
      <div className="mt-0.5 text-2xl font-bold text-white drop-shadow-sm sm:text-3xl"><CountUp value={value} fmt={fmt} locale={locale} /></div>
      {sub && <div className="mt-0.5 text-xs text-white/75">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-white">{body}</Link> : body;
}

/** Vivid glossy tile with a gradient icon chip and a counting number. */
export function Tile({ icon: Icon, label, value, fmt = "int", locale, hint, href, tone = "tone-blue", i = 0, testId, children }: {
  icon: LucideIcon; label: string; value?: number; fmt?: Fmt | "int"; locale: string; hint?: ReactNode; href?: string; tone?: string; i?: number; testId?: string; children?: ReactNode;
}) {
  const body = (
    <div className={`tile gloss motion-rise motion-lift h-full rounded-xl border p-4 ${tone}`} style={{ ["--i" as string]: i } as CSSProperties} data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="tile-chip hidden size-11 shrink-0 place-items-center rounded-xl motion-float sm:grid"><Icon className="size-5" aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_oklch,var(--tone)_70%,var(--foreground))]">{label}</p>
          {value !== undefined && <p className="whitespace-nowrap text-lg font-bold tabular-nums sm:text-2xl"><CountUp value={value} fmt={fmt} locale={locale} /></p>}
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
          {children}
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-xl">{body}</Link> : body;
}

export type TickerOrder = { id: string; number: string; who: string; city: string | null; net: string; placedAt: Date; status: string };
const STATUS_DOT: Record<string, string> = { DELIVERED: "var(--vivid-lime)", CANCELLED: "var(--muted-foreground)", EXCEPTION: "var(--vivid-pink)", OUT_FOR_DELIVERY: "var(--vivid-teal)", DISPATCHED: "var(--vivid-teal)" };

/** Endless ribbon of the latest orders. */
export function OrderTicker({ orders, locale, base, label, statusLabel }: { orders: TickerOrder[]; locale: string; base: string; label: string; statusLabel: (s: string) => string }) {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  return (
    <Ticker label={label} seconds={Math.max(30, orders.length * 5)} items={orders.map((o) => (
      <Link key={o.id} href={`${base}/${o.id}`} className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm transition hover:border-[color:var(--vivid-violet)]">
        <span className="size-2 rounded-full" style={{ background: STATUS_DOT[o.status] ?? "var(--vivid-orange)" }} aria-hidden />
        <span className="font-semibold text-[color:color-mix(in_oklch,var(--vivid-blue)_80%,var(--foreground))]">{o.number}</span>
        <span>{o.who}{o.city ? ` · ${o.city}` : ""}</span>
        <span className="font-semibold tabular-nums">{formatMoney(o.net, locale)}</span>
        <span className="text-muted-foreground">{statusLabel(o.status)} · {time.format(o.placedAt)}</span>
      </Link>
    ))} />
  );
}

/** Top-N with animated gradient bars (decorative colour per row; value as text). */
export function TopBars({ rows, locale, empty }: { rows: { label: string; value: number }[]; locale: string; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const tones = ["var(--vivid-blue)", "var(--vivid-violet)", "var(--vivid-pink)", "var(--vivid-orange)", "var(--vivid-teal)"];
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate">{r.label}</span><span className="font-semibold tabular-nums"><CountUp value={r.value} fmt="money" locale={locale} /></span></div>
          <div className="h-2.5 rounded-full bg-muted">
            <div className="motion-grow-x h-2.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: `linear-gradient(90deg, ${tones[i % 5]}, ${tones[(i + 1) % 5]})`, ["--i" as string]: i } as CSSProperties} />
          </div>
        </li>
      ))}
    </ul>
  );
}
