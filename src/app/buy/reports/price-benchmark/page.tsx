import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Euro, Scale } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { benchAccess, mine, trend } from "@/server/benchmark/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { benchLabels } from "@/components/benchmark/labels";
import { RangeBar, eur, fill, unitEur } from "@/components/benchmark/views";
import { AddAlternative } from "@/components/benchmark/client";

export const metadata = { title: "Price Benchmark" };
export const dynamic = "force-dynamic";
const tone = { ABOVE: "destructive", AROUND: "secondary", BELOW: "success" } as const;

/** Phase 70: the customer's prices against similar businesses (anonymous), savings, cheaper offers, basket, trend. */
export default async function PriceBenchmarkPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.reports.view", "buyer.orders.view", "buyer.orders.place"]);
  if (!(await benchAccess(ctx.company)).buyer) notFound();
  const { l, locale } = await benchLabels();
  const [m, t] = await Promise.all([mine(ctx, locale), trend(ctx, locale)]);
  const canBuy = can(ctx, "buyer.orders.place");
  const savers = m.items.filter((i) => i.saving > 0);
  const Row = ({ i, withAlt }: { i: (typeof m.items)[number]; withAlt: boolean }) => (
    <li className="space-y-2 py-3" data-testid="bm-row" data-band={i.band ?? "NONE"} data-sku={i.sku}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 basis-56 break-words font-medium">{i.product} <span className="text-xs font-normal text-muted-foreground">{i.sku}</span></span>
        {i.band && <Badge variant={tone[i.band]}>{l[`band.${i.band}`]}</Badge>}
        {i.saving > 0 && <span className="text-sm font-semibold tabular-nums text-destructive" data-testid="bm-saving">{eur(locale, i.saving, 0)} / {l.saving.toLowerCase()}</span>}
      </div>
      {i.stats ? (
        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="text-sm">
            <p>{l.yourPrice}: <span className="font-semibold tabular-nums">{unitEur(locale, i.unitPrice)}</span></p>
            <p className="text-xs text-muted-foreground">{fill(l.median, { price: unitEur(locale, i.stats.p50) })} · {fill(l.range, { low: unitEur(locale, i.stats.p25), high: unitEur(locale, i.stats.p75) })}</p>
            <p className="text-xs text-muted-foreground">{i.position !== null ? fill(l.position, { pct: i.position }) : ""} · {l[`level.${i.level}`]} · {fill(l.buyers, { n: i.stats.buyers })}</p>
          </div>
          <RangeBar s={i.stats} value={i.unitPrice} label={`${l.yourPrice} ${unitEur(locale, i.unitPrice)}; ${fill(l.median, { price: unitEur(locale, i.stats.p50) })}; ${fill(l.range, { low: unitEur(locale, i.stats.p25), high: unitEur(locale, i.stats.p75) })}`} />
        </div>
      ) : <p className="text-xs text-muted-foreground">{l.yourPrice}: {unitEur(locale, i.unitPrice)} · {l.notEnough}</p>}
      {withAlt && i.alternatives.length > 0 && (
        <div className="space-y-1 rounded-lg border bg-muted/20 p-2" data-testid="bm-alts">
          <p className="text-xs font-medium">{l.cheaper}</p>
          <ul className="space-y-1">{i.alternatives.map((a) => (
            <li key={a.offerId} className="flex flex-wrap items-center gap-2 text-sm" data-testid="bm-alt">
              <span className="min-w-0 flex-1 basis-48 break-words">{a.vendor} · {a.pack} · {eur(locale, a.price)} <span className="text-xs text-muted-foreground">({fill(l.perUnit, { price: unitEur(locale, a.unitPrice) })})</span></span>
              <span className="text-xs text-[color:var(--success,#16a34a)]">−{eur(locale, a.saving, 0)}</span>
              {canBuy && <AddAlternative l={l} offerId={a.offerId} qty={Math.max(1, Math.round(i.units / m.periodDays * 14 / Math.max(1, a.unitsPerPack)))} />}
            </li>
          ))}</ul>
        </div>
      )}
    </li>
  );
  return (
    <>
      <PageHeader title={l.title} icon={Scale} description={<><span className="block">{l.intro}</span><span className="mt-1 block text-xs">{fill(l.anon, { n: m.minBuyers })}{m.computedAt ? ` · ${fill(l.updated, { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(m.computedAt)) })}` : ""}</span></>} />
      {!m.items.length ? <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground" data-testid="bm-empty">{fill(l.noData, { days: m.periodDays })}</p></CardContent></Card> : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {m.parts.savings && <Tile icon={Euro} label={l.savingYear} value={m.totals.savingYear} fmt="money" locale={locale} tone={m.totals.savingYear > 0 ? "tone-orange" : "tone-lime"} testId="bm-total" />}
            <Tile icon={Boxes} label={l.compared} value={m.totals.compared} locale={locale} tone="tone-blue" i={1} hint={`${m.totals.products}`} />
            <Tile icon={ArrowUpRight} label={l.above} value={m.totals.above} locale={locale} tone="tone-pink" i={2} />
            <Tile icon={ArrowDownRight} label={l.below} value={m.totals.below} locale={locale} tone="tone-teal" i={3} />
          </div>
          {m.parts.savings && (
            <Card>
              <CardHeader><CardTitle>{l.savingsTitle}</CardTitle></CardHeader>
              <CardContent>{!savers.length ? <p className="text-sm text-muted-foreground" data-testid="bm-nothing">{l.nothingToSave}</p> : <ul className="divide-y" data-testid="bm-savers">{savers.slice(0, 15).map((i) => <Row key={i.variantId} i={i} withAlt={m.parts.alternatives} />)}</ul>}</CardContent>
            </Card>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            {m.basket && (
              <Card>
                <CardHeader><CardTitle>{l.basket}</CardTitle><CardDescription>{fill(l.basketHint, { days: m.periodDays })}</CardDescription></CardHeader>
                <CardContent className="grid grid-cols-3 gap-3 text-sm" data-testid="bm-basket">
                  <div><p className="text-xs text-muted-foreground">{l.spent}</p><p className="text-lg font-semibold tabular-nums">{eur(locale, m.basket.spend, 0)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{l.atMedian}</p><p className="text-lg font-semibold tabular-nums">{eur(locale, m.basket.atMedian, 0)}</p></div>
                  <div><p className="text-xs text-muted-foreground">{l.basketSaving}</p><p className={`text-lg font-semibold tabular-nums ${m.basket.spend > m.basket.atMedian ? "text-destructive" : "text-[color:var(--success,#16a34a)]"}`}>{eur(locale, m.basket.spend - m.basket.atMedian, 0)}</p></div>
                </CardContent>
              </Card>
            )}
            {m.parts.trend && (
              <Card>
                <CardHeader><CardTitle>{l.trendTitle}</CardTitle></CardHeader>
                <CardContent>
                  {!t.products.length ? <p className="text-sm text-muted-foreground">{l.noTrend}</p> : (
                    <div className="overflow-x-auto" data-testid="bm-trend">
                      <table className="w-full text-xs tabular-nums">
                        <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">{l.product}</th>{t.months.map((mo) => <th key={mo} className="px-1 py-1 text-right font-medium">{new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${mo}-01T00:00:00Z`))}</th>)}</tr></thead>
                        <tbody>{t.products.map((p) => (
                          <tr key={p.variantId} className="border-t align-top">
                            <td className="py-1 pr-2"><span className="block max-w-[12rem] break-words">{p.product}</span>{p.gap > (t.risePp ?? 5) && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" /> {fill(l.riseWarning, { pp: p.gap })}</span>}</td>
                            {p.mine.map((v, k) => <td key={k} className="px-1 py-1 text-right"><span className="block">{v == null ? "—" : unitEur(locale, v)}</span><span className="block text-muted-foreground">{p.market[k] == null ? "·" : unitEur(locale, p.market[k]!)}</span></td>)}
                          </tr>
                        ))}</tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-muted-foreground">{l.you} / <span>{l.marketMedian}</span></p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
          <Card>
            <CardHeader><CardTitle>{l.allTitle}</CardTitle></CardHeader>
            <CardContent><ul className="divide-y" data-testid="bm-all">{m.items.map((i) => <Row key={i.variantId} i={i} withAlt={false} />)}</ul></CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
