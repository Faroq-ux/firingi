import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Droplets, Euro, Leaf, Lightbulb, Recycle, Truck } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { servicesAccess } from "@/server/servicing/settings";
import { oilSummary } from "@/server/servicing/oil";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { svLabels } from "@/components/services/labels";
import { day, fill, money, num } from "@/components/services/text";
import { DeleteLog, FryerForm, FryerLog } from "@/components/services/client";

export const metadata = { title: "Fryers & Oil" };
export const dynamic = "force-dynamic";

const TONE = { OK: "success", SOON: "warning", CHANGE: "destructive" } as const;

/** Phase 68: fryers & used cooking oil — log per fryer, when the oil is due, containers, totals and tips. */
export default async function BuyOilPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.services.manage", "buyer.services.log"]);
  if (!(await servicesAccess(ctx.company)).oil) notFound();
  const [{ l, locale }, o] = await Promise.all([svLabels(), oilSummary(ctx)]);
  const manage = can(ctx, "buyer.services.manage");
  const st = o.storage;
  const names = Object.fromEntries(o.fryers.map((f) => [f.id, f.name]));
  return (
    <>
      <PageHeader title={l.oilTitle} description={<><span className="block">{l.oilIntro}</span><span className="mt-1 block text-xs">{fill(l.rules, { days: o.rules.changeDays, pct: o.rules.maxPolarPct })}</span></>} icon={Droplets}
        actions={manage ? <FryerForm l={l} /> : undefined} />
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Recycle} label={l.storage} locale={locale} tone={st.full ? "tone-orange" : "tone-teal"} testId="oil-storage"
            hint={st.plan ? <>
              {st.capacity ? fill(l.storageOf, { litres: num(locale, st.litres), capacity: num(locale, st.capacity) }) : fill(l.storageNoSize, { litres: num(locale, st.litres) })}
              {st.pct !== null && <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, st.pct)} aria-label={l.storage}><span className={`block h-full ${st.full ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, st.pct)}%` }} /></span>}
              {st.lastCollection?.doneAt && <span className="mt-1 block">{fill(l.lastCollection, { date: day(locale, st.lastCollection.doneAt) })}</span>}
            </> : <Link className="underline" href="/buy/services">{l.noOilPlan}</Link>}>
            {st.pct !== null && <p className="kpi-value mt-0.5">{st.pct}%</p>}
          </Tile>
          <Tile icon={Droplets} label={l.fresh30} value={o.totals.fresh30} fmt="number" locale={locale} tone="tone-blue" i={1} hint={o.totals.cost30 > 0 ? `${l.cost30}: ${money(locale, o.totals.cost30)}` : undefined} />
          <Tile icon={Truck} label={l.collected90} value={o.totals.collected90} fmt="number" locale={locale} tone="tone-violet" i={2} hint={o.buybackOn && o.totals.paid90 > 0 ? `${l.paid90}: ${money(locale, o.totals.paid90)}` : undefined} />
          <Tile icon={Leaf} label={l.co2} value={o.totals.co2Saved90} fmt="number" locale={locale} tone="tone-lime" i={3} hint="kg CO₂e" />
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4" /> {l.insights}</CardTitle></CardHeader>
          <CardContent>
            {!o.insights.length ? <p className="text-sm text-muted-foreground" data-testid="oil-no-insights">{l.noInsights}</p> : (
              <ul className="space-y-1 text-sm" data-testid="oil-insights">
                {o.insights.map((x, i) => <li key={i} className="flex items-start gap-2" data-code={x.code}><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${x.code === "CHANGE_NOW" || x.code === "FULL" ? "text-destructive" : "text-amber-600"}`} />{fill(l[`insight.${x.code}`], { fryer: x.fryer ?? "", n: x.n ?? "" })}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{l.fryers}</CardTitle></CardHeader>
          <CardContent>
            {!o.fryers.length ? <p className="text-sm text-muted-foreground" data-testid="oil-no-fryers">{l.noFryers}</p> : (
              <ul className="divide-y">
                {o.fryers.map((f) => (
                  <li key={f.id} className="space-y-2 py-3" data-testid="oil-fryer-row" data-status={f.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words font-medium">{f.name}</span>
                      <span className="text-xs text-muted-foreground">{num(locale, f.capacityL)} L{f.oilName ? ` · ${f.oilName}` : ""}</span>
                      {f.active ? <Badge variant={TONE[f.status]}>{l[`fryerStatus.${f.status}`]}</Badge> : <Badge variant="secondary">{l.inactive}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {f.days === null ? l.never : fill(l.daysSince, { n: f.days })}{f.lastPolarPct !== null ? ` · ${fill(l.lastPolar, { pct: num(locale, f.lastPolarPct) })}` : ""}
                      {` · ${l.litres30}: ${num(locale, f.litres30)} L · ${l.changes30}: ${f.changes30}`}{f.cost30 !== null ? ` · ${l.cost30}: ${money(locale, f.cost30)}` : ""}
                    </p>
                    <div className="flex flex-wrap items-start gap-2">
                      {f.active && <FryerLog l={l} fryerId={f.id} capacityL={f.capacityL} />}
                      {manage && <FryerForm l={l} fryer={{ id: f.id, name: f.name, capacityL: f.capacityL, oilName: f.oilName, oilCostPerL: f.oilCostPerL, active: f.active }} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{l.recentLog}</CardTitle><CardDescription className="flex items-center gap-1"><Euro className="size-3.5" /> {l.cost30}: {money(locale, o.totals.cost30)} · {l["logKind.CHANGE"]}: {num(locale, o.totals.changed30)} L</CardDescription></CardHeader>
          <CardContent>
            {!o.logs.length ? <p className="text-sm text-muted-foreground">—</p> : (
              <ul className="divide-y" data-testid="oil-log-list">
                {o.logs.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="oil-log-row" data-kind={g.kind}>
                    <span className="w-28 shrink-0 tabular-nums">{day(locale, g.at)}</span>
                    <span className="min-w-0 flex-1 basis-40 break-words">{names[g.fryerId] ?? "—"} · {l[`logKind.${g.kind}`] ?? g.kind}{g.litres != null ? ` · ${num(locale, Number(g.litres))} L` : ""}{g.polarPct != null ? ` · ${num(locale, Number(g.polarPct))}%` : ""}{g.note ? <span className="block text-xs text-muted-foreground">{g.note}</span> : null}</span>
                    {(g.byUserId === ctx.user.id || manage) && <DeleteLog l={l} id={g.id} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
