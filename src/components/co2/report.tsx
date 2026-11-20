/** Sustainability & CO₂ (Phase 51) — the green report (buyers, suppliers, FIRINGI). Server component. */
import { Download, Leaf, MapPin, Package, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { co2ReportFor } from "@/server/co2/service";
import { fill, kgText } from "./labels";

type R = Awaited<ReturnType<typeof co2ReportFor>>;
export function Co2Report({ r, l, locale, exportBase, partyLabel, years, yearHref }: { r: R; l: Record<string, string>; locale: string; exportBase: string | null; partyLabel: string; years: number[]; yearHref: (y: number) => string }) {
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  const max = Math.max(1, ...r.months.map((m) => m.total));
  const month = (m: number) => new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(Date.UTC(2026, m - 1, 1)));
  const tiles = [
    { icon: Leaf, label: l.totalYear, value: kgText(r.total, locale), id: "co2-total" },
    { icon: Package, label: l.perEuro, value: r.kgPerEuro != null ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(r.kgPerEuro)} kg / €` : "—", id: "co2-per-euro" },
    { icon: MapPin, label: l.localShare, value: r.localShare != null ? `${r.localShare} %` : "—", id: "co2-local" },
    { icon: Truck, label: l.deliveryShare, value: r.total > 0 ? `${Math.round((r.parts.delivery / r.total) * 100)} %` : "—", id: "co2-delivery" },
  ];
  return (
    <div className="space-y-6" data-testid="co2-report">
      <div className="flex flex-wrap items-center gap-2">
        {years.map((y) => <a key={y} href={yearHref(y)} className={`rounded-full border px-3 py-1 text-xs ${y === r.year ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`} data-testid={`co2-year-${y}`}>{y}</a>)}
        {exportBase && r.settings.show.export && <span className="ml-auto flex gap-2"><a href={`${exportBase}&format=csv`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted" data-testid="co2-csv"><Download className="size-3.5" />CSV</a><a href={`${exportBase}&format=pdf`} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-muted" data-testid="co2-pdf"><Download className="size-3.5" />PDF</a></span>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => <Card key={t.id}><CardContent className="flex items-center gap-3 pt-5"><t.icon className="size-5 shrink-0 text-[color:var(--vivid-teal)]" aria-hidden /><div className="min-w-0"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-lg font-semibold tabular-nums" data-testid={t.id}>{t.value}</p></div></CardContent></Card>)}
      </div>
      {r.goal && (
        <Card data-testid="co2-goal">
          <CardContent className="space-y-1 pt-5 text-sm">
            <p className="font-medium">{fill(l.goalLine, { pct: r.goal.reductionPct, year: r.year })}</p>
            <p className="text-muted-foreground">{r.goal.lastYear > 0 ? fill(l.goalProgress, { now: kgText(r.goal.thisYear, locale), last: kgText(r.goal.lastYear, locale), target: kgText(r.goal.target, locale) }) : l.goalNoHistory}</p>
            {r.goal.onTrack != null && <p className={r.goal.onTrack ? "text-[color:var(--vivid-teal)]" : "text-amber-600"}>{r.goal.onTrack ? l.onTrack : l.offTrack}{r.goal.change != null ? ` (${r.goal.change > 0 ? "+" : ""}${r.goal.change} %)` : ""}</p>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{l.byMonth}</CardTitle></CardHeader>
        <CardContent>
          {r.total <= 0 ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noData}</p> : (
            <>
              <div className="flex h-40 items-end gap-1.5" role="img" aria-label={l.byMonth} data-testid="co2-months">
                {r.months.map((m) => (
                  <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${month(m.month)}: ${kgText(m.total, locale)}`}>
                    <div className="flex w-full flex-col justify-end gap-[2px] rounded-t" style={{ height: `${Math.max(2, (m.total / max) * 128)}px` }}>
                      <div className="w-full rounded-t-[4px] bg-[color:var(--vivid-teal)]" style={{ flex: m.products || 0.0001 }} />
                      {m.packaging > 0 && <div className="w-full bg-[color:var(--vivid-blue)]" style={{ flex: m.packaging }} />}
                      {m.delivery > 0 && <div className="w-full bg-[color:var(--vivid-violet)]" style={{ flex: m.delivery }} />}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{month(m.month)}</span>
                  </div>
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-4 text-xs">
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[color:var(--vivid-teal)]" />{l.products} · {kgText(r.parts.products, locale)}</li>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[color:var(--vivid-blue)]" />{l.packagingPart} · {kgText(r.parts.packaging, locale)}</li>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[color:var(--vivid-violet)]" />{l.delivery} · {kgText(r.parts.delivery, locale)}</li>
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>{l.byCategory}</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm" data-testid="co2-categories">{r.categories.slice(0, 10).map((c) => <li key={c.name} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{c.name}</span><span className="tabular-nums">{kgText(c.kg, locale)}</span></li>)}{!r.categories.length && <li className="py-2 text-muted-foreground">{l.noData}</li>}</ul></CardContent></Card>
        <Card><CardHeader><CardTitle>{partyLabel}</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm" data-testid="co2-parties">{r.parties.slice(0, 10).map((p) => <li key={p.name} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{p.name}</span><span className="text-right tabular-nums">{kgText(p.kg, locale)}<span className="block text-xs text-muted-foreground">{money(p.net)}</span></span></li>)}{!r.parties.length && <li className="py-2 text-muted-foreground">{l.noData}</li>}</ul></CardContent></Card>
        <Card><CardHeader><CardTitle>{l.topProducts}</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm" data-testid="co2-products">{r.products.map((p) => <li key={p.sku} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{p.name}</span><span className="tabular-nums">{kgText(p.kg, locale)}</span></li>)}{!r.products.length && <li className="py-2 text-muted-foreground">{l.noData}</li>}</ul></CardContent></Card>
      </div>
      <p className="text-xs text-muted-foreground">{l.method}</p>
    </div>
  );
}
