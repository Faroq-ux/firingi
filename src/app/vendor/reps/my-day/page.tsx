import Link from "next/link";
import { ChevronLeft, ChevronRight, Phone, Sun } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myDay, myRep } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { CheckInButton, PlanVisitForm, VisitActions } from "@/components/salesreps/client";
import { TargetBar, VisitBadge, VisitMap } from "@/components/salesreps/views";
import { fill, srLabels } from "@/components/salesreps/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "My day" };
export const dynamic = "force-dynamic";

const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.field");
  const { l, locale } = await srLabels();
  if (!(await myRep(ctx))?.active) return <><PageHeader title={l.myDayTitle} icon={Sun} /><p className="rounded-md bg-muted p-3 text-sm" data-testid="sr-not-rep">{l.noMyCustomers}</p></>;
  const { date } = await searchParams;
  const d = await myDay(ctx, date);
  const m = (n: number) => formatMoney(n, locale);
  const today = new Date().toISOString().slice(0, 10);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`));
  const visited = new Set(d.visits.map((v) => v.buyerCompanyId));
  return (
    <>
      <PageHeader title={l.myDayTitle} description={l.myDayIntro} icon={Sun} />
      {!d.enabled && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="sr-off">{l.off}</p>}
      <div className="mb-4 flex items-center gap-2">
        <Link href={`?date=${shift(d.date, -1)}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label={l.prevDay}><ChevronLeft className="size-4" /></Link>
        <p className="min-w-0 flex-1 text-center font-medium capitalize" data-testid="md-date">{dayLabel}</p>
        <Link href={`?date=${shift(d.date, 1)}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label={l.nextDay}><ChevronRight className="size-4" /></Link>
        {d.date !== today && <Link href="?" className={buttonVariants({ variant: "ghost", size: "sm" })}>{l.today}</Link>}
      </div>
      <Card className="mb-4">
        <CardContent className="space-y-2 pt-5" data-testid="md-month">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">{l.monthProgress}</span>
            <span className="text-lg font-semibold tabular-nums">{m(d.month.delivered)}{d.rep.monthlyTarget != null && <span className="text-sm font-normal text-muted-foreground"> / {m(d.rep.monthlyTarget)}</span>}</span>
          </div>
          <TargetBar pct={d.month.targetPct} />
          <p className="text-xs text-muted-foreground">{[d.month.targetPct != null ? fill(l.ofTarget, { pct: d.month.targetPct }) : null, `${l.commission}: ${m(d.month.commission)}`, `${l.visitsDone}: ${d.month.visitsDone}`, `${l.repOrders}: ${d.month.repOrders}`].filter(Boolean).join(" · ")}</p>
        </CardContent>
      </Card>
      {d.visits.some((v) => v.at) && <div className="mb-4"><VisitMap l={l} reps={[{ id: d.rep.id, name: l.myDayTitle, visits: d.visits }]} height={200} /></div>}
      <div className="space-y-3" data-testid="md-visits">
        {!d.visits.length && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{l.noVisits}</p>}
        {d.visits.map((v, i) => (
          <Card key={v.id} data-testid="md-visit" data-customer={v.name}>
            <CardContent className="space-y-2 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs tabular-nums">{i + 1}</span>
                <Link href={`/vendor/reps/my-customers/${v.buyerCompanyId}`} className="min-w-0 flex-1 font-medium break-words hover:underline">{v.name}</Link>
                <VisitBadge l={l} status={v.status} />
              </div>
              <p className="text-sm text-muted-foreground break-words">{[v.address, v.lastOrder ? fill(l.daysSince, { n: Math.max(0, Math.floor((Date.now() - Date.parse(v.lastOrder)) / 86400_000)) }) : l.noOrdersYet, v.openOrders ? fill(l.openOrders, { n: v.openOrders }) : null, v.checkInAt ? fill(l.checkedIn, { time: time.format(new Date(v.checkInAt)) }) : null].filter(Boolean).join(" · ")}</p>
              {v.note && <p className="text-sm break-words">{v.note}</p>}
              {v.outcome && <p className="text-sm">{l[`outcome.${v.outcome}`]}</p>}
              <div className="flex flex-wrap gap-2">
                {v.phone && <a href={`tel:${v.phone}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Phone className="size-4" /> {l.call}</a>}
                {v.address && <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(v.address)}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>{l.directions}</a>}
              </div>
              {v.status === "PLANNED" && d.date === today && <VisitActions l={l} id={v.id} buyerCompanyId={v.buyerCompanyId} checkedIn={!!v.checkInAt} photos={v.photos} maxPhotos={d.maxPhotos} />}
            </CardContent>
          </Card>
        ))}
      </div>
      {d.date === today && d.customers.some((c) => !visited.has(c.id)) && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">{l.unplanned}</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="md-unplanned">
              {d.customers.filter((c) => !visited.has(c.id)).slice(0, 12).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 basis-40 break-words">{c.name} <span className="text-xs text-muted-foreground">· {c.days == null ? l.noOrdersYet : fill(l.daysSince, { n: c.days })}</span></span>
                  <CheckInButton l={l} buyerCompanyId={c.id} variant="outline" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {d.customers.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">{l.planVisit}</CardTitle></CardHeader>
          <CardContent><PlanVisitForm l={l} date={d.date < today ? today : d.date} customers={d.customers.map((c) => ({ id: c.id, name: c.name }))} /></CardContent>
        </Card>
      )}
    </>
  );
}
