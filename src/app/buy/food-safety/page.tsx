import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarCheck, ClipboardCheck, FileText, Lightbulb, ShieldCheck, Thermometer, Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { haccpAccess, today } from "@/server/haccp/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tile } from "@/components/motion/dashboard-kit";
import { haccpLabels } from "@/components/haccp/labels";
import { fill, stateTone, temp, when } from "@/components/haccp/text";
import { CoolingForm, TaskEntry, TempEntry } from "@/components/haccp/client";

export const metadata = { title: "Today's Checks" };
export const dynamic = "force-dynamic";

/** Phase 69: the day's food safety checks — temperatures at their times, checklists and cleaning, cooling, issues and tips. */
export default async function FoodSafetyToday() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.haccp.manage", "buyer.haccp.log"]);
  if (!(await haccpAccess(ctx.company)).on) notFound();
  const [{ l, locale }, t] = await Promise.all([haccpLabels(), today(ctx)]);
  const p = t.settings.parts;
  return (
    <>
      <PageHeader title={l.todayTitle} description={l.todayIntro} icon={ShieldCheck}
        actions={p.reports ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/buy/food-safety/log" data-testid="hc-to-log"><FileText className="size-4" /> {l.report}</Link> : undefined} />
      {!t.setUp ? (
        <Card><CardContent className="space-y-3 pt-6" data-testid="hc-not-setup">
          <p>{l.notSetUp}</p>
          {t.manage ? <Link className={buttonVariants({ size: "sm" })} href="/buy/food-safety/setup">{l.setUpCta}</Link> : <p className="text-sm text-muted-foreground">{l.askManager}</p>}
        </CardContent></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile icon={CalendarCheck} label={l.today} value={t.today.pct / 100} fmt="percent" locale={locale} tone={t.today.pct >= 90 ? "tone-teal" : "tone-orange"} hint={fill(l.doneOf, { done: t.today.done, due: t.today.due })} testId="hc-today" />
            <Tile icon={ClipboardCheck} label={l.week} value={t.week.pct / 100} fmt="percent" locale={locale} tone={t.week.pct >= 90 ? "tone-blue" : "tone-orange"} i={1} hint={fill(l.doneOf, { done: t.week.done, due: t.week.due })} testId="hc-week" />
            <Tile icon={AlertTriangle} label={l.issues} value={t.issues.length} locale={locale} tone={t.issues.length ? "tone-pink" : "tone-lime"} i={2} />
          </div>

          {p.temperatures && t.units.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Thermometer className="size-4" /> {l.temps}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {t.units.map((u) => (
                    <li key={u.id} className="space-y-2 py-3" data-testid="hc-unit-row" data-unit={u.name}>
                      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words font-medium">{u.name}</span><span className="text-xs text-muted-foreground">{l[`unitKind.${u.kind}`]} · {fill(l.limit, { limit: u.limit })}</span></div>
                      <div className="flex flex-wrap items-start gap-2">
                        {u.slots.map((s) => {
                          const r = u.last.find((x) => x.slot === s.time);
                          return s.state === "DONE" || s.state === "OUT"
                            ? <Badge key={s.time} variant={stateTone(s.state)} data-testid="hc-slot" data-state={s.state}>{s.time} · {temp(locale, r?.valueC)}</Badge>
                            : <span key={s.time} className="inline-flex flex-col gap-1" data-testid="hc-slot" data-state={s.state}><Badge variant={stateTone(s.state)}>{s.time} · {l[`state.${s.state}`]}</Badge><TempEntry l={l} unitId={u.id} slot={s.time} minC={u.minC} maxC={u.maxC} limit={u.limit} /></span>;
                        })}
                        {!u.slots.length && <TempEntry l={l} unitId={u.id} slot={null} minC={u.minC} maxC={u.maxC} limit={u.limit} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {t.tasks.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-4" /> {l.tasks}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {t.tasks.map((x) => (
                    <li key={x.id} className="space-y-2 py-3" data-testid="hc-task-row" data-done={x.done ? "1" : "0"}>
                      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words font-medium">{x.name}</span><Badge variant="secondary">{l[`taskKind.${x.kind}`]} · {l[`freq.${x.frequency}`]}</Badge>
                        {x.done && <Badge variant={x.done.ok ? "success" : "destructive"}>{fill(l.doneBy, { name: x.done.by ?? "—" })}</Badge>}</div>
                      {!x.done && <TaskEntry l={l} task={x} />}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {(p.cooling || p.deliveries) && (
              <Card>
                <CardHeader><CardTitle>{l.cooling}{p.deliveries ? ` · ${l.recordDelivery}` : ""}</CardTitle>{p.deliveries && <CardDescription>{fill(l.deliveriesToday, { n: t.deliveriesToday })}</CardDescription>}</CardHeader>
                <CardContent className="flex flex-wrap items-start gap-3">
                  {p.cooling && <CoolingForm l={l} target={t.settings.rules.coolingTargetC} maxMinutes={t.settings.rules.coolingMaxMinutes} />}
                  {p.deliveries && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/buy/food-safety/deliveries" data-testid="hc-to-deliveries"><Truck className="size-4" /> {l.recordDelivery}</Link>}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4" /> {l.issues}</CardTitle></CardHeader>
              <CardContent>
                {!t.issues.length ? <p className="text-sm text-muted-foreground" data-testid="hc-no-issues">{l.noIssues}</p> : (
                  <ul className="space-y-2 text-sm" data-testid="hc-issues">{t.issues.map((i) => <li key={i.id}><span className="font-medium">{i.what}</span> <span className="text-muted-foreground">· {l[`kind.${i.kind}`]} · {when(locale, i.at)}{i.valueC != null ? ` · ${temp(locale, i.valueC)}` : ""}</span>{i.corrective && <span className="block text-xs">→ {i.corrective}</span>}</li>)}</ul>
                )}
              </CardContent>
            </Card>
          </div>

          {t.tips.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4" /> {l.tips}</CardTitle></CardHeader>
              <CardContent><ul className="space-y-1 text-sm" data-testid="hc-tips">{t.tips.map((x, i) => <li key={i} data-code={x.code} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />{fill(l[`tip.${x.code}`], { what: x.what ?? "", n: x.n ?? "", value: x.value ?? "", date: x.date ?? "" })}</li>)}</ul></CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
