import { MapPinned } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { teamVisits } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanVisitForm } from "@/components/salesreps/client";
import { VisitBadge, VisitMap } from "@/components/salesreps/views";
import { fill, srLabels } from "@/components/salesreps/labels";

export const metadata = { title: "Visit plan & map" };
export const dynamic = "force-dynamic";

export default async function RepVisitsPage({ searchParams }: { searchParams: Promise<{ date?: string; rep?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.manage");
  const { date, rep } = await searchParams;
  const [{ l, locale }, v] = await Promise.all([srLabels(), teamVisits(ctx, date)]);
  const reps = rep ? v.reps.filter((r) => r.id === rep) : v.reps;
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  return (
    <>
      <PageHeader title={l.visitsTitle} description={l.visitsIntro} icon={MapPinned} />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="space-y-1 text-sm"><span className="block">{l.date}</span><Input type="date" name="date" defaultValue={v.date} className="w-44" data-testid="sv-date" /></label>
        {rep && <input type="hidden" name="rep" value={rep} />}
        <Button type="submit" variant="outline">{l.show}</Button>
      </form>
      <div className="mb-6"><VisitMap l={l} reps={reps} height={300} /></div>
      {v.reps.some((r) => r.active && r.customers.length) && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.planVisit}</CardTitle></CardHeader>
          <CardContent><PlanVisitForm l={l} date={v.date} reps={v.reps.filter((r) => r.active && r.customers.length).map((r) => ({ id: r.id, name: r.name, customers: r.customers }))} /></CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2" data-testid="sv-reps">
        {reps.map((r) => (
          <Card key={r.id} data-testid="sv-rep">
            <CardHeader><CardTitle className="text-base">{r.name} <span className="text-sm font-normal text-muted-foreground">· {r.visits.length}</span></CardTitle></CardHeader>
            <CardContent>
              {!r.visits.length ? <p className="text-sm text-muted-foreground">{l.noVisits}</p> : (
                <ol className="space-y-3">
                  {r.visits.map((x, i) => (
                    <li key={x.id} className="flex gap-3 text-sm" data-testid="sv-visit">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-words">{x.customer}</span><VisitBadge l={l} status={x.status} />{x.outcome && <span className="text-xs text-muted-foreground">{l[`outcome.${x.outcome}`]}</span>}</div>
                        <p className="text-xs text-muted-foreground">{[x.city, x.checkInAt ? fill(l.checkedIn, { time: time.format(new Date(x.checkInAt)) }) : null, x.at ? null : l.noPlace].filter(Boolean).join(" · ")}</p>
                        {x.note && <p className="break-words">{x.note}</p>}
                        {x.photos > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {Array.from({ length: x.photos }, (_, n) => (
                              <a key={n} href={`/api/salesreps/visits/${x.id}/${n}`} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/salesreps/visits/${x.id}/${n}`} alt={fill(l.photo, { n: n + 1 })} className="size-16 rounded-md border object-cover" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
