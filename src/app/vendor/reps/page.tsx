import Link from "next/link";
import { Download, Handshake } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { salesRepSettings, team } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RepForm } from "@/components/salesreps/client";
import { TargetBar, Tiles } from "@/components/salesreps/views";
import { fill, srLabels } from "@/components/salesreps/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Sales team" };
export const dynamic = "force-dynamic";

export default async function SalesTeamPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.manage");
  const { month } = await searchParams;
  const [{ l, locale }, t, s] = await Promise.all([srLabels(), team(ctx, month), salesRepSettings()]);
  const m = (n: number) => formatMoney(n, locale);
  const sum = (k: "customers" | "visitsDone" | "repOrders" | "delivered" | "commission") => t.reps.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHeader title={l.teamTitle} description={l.teamIntro} icon={Handshake}
        actions={<a href={`/api/salesreps/results?month=${t.month}`} className={buttonVariants({ variant: "outline" })} data-testid="sr-csv"><Download className="size-4" /> {l.downloadCsv}</a>} />
      {!s.enabled && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="sr-off">{l.off}</p>}
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="space-y-1 text-sm"><span className="block">{l.month}</span><Input type="month" name="month" defaultValue={t.month} className="w-44" /></label>
        <Button type="submit" variant="outline">{l.show}</Button>
      </form>
      <Tiles items={[
        { label: l.activeReps, value: `${t.reps.filter((r) => r.active).length} / ${t.reps.length}` },
        { label: l.customers, value: String(sum("customers")) },
        { label: l.visitsDone, value: String(sum("visitsDone")) },
        { label: l.deliveredNet, value: m(sum("delivered")), testid: "sr-delivered" },
      ]} />
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.reps}</CardTitle><CardDescription>{l.commissionNote}</CardDescription></CardHeader>
        <CardContent>
          {!t.reps.length ? <p className="text-sm text-muted-foreground">{l.noReps}</p> : (
            <ul className="divide-y" data-testid="sr-reps">
              {t.reps.map((r) => (
                <li key={r.id} className="space-y-3 py-4" data-testid="sr-rep" data-rep={r.name}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-48 font-medium break-words">{r.name} <span className="text-xs font-normal text-muted-foreground">· {r.email}</span></span>
                    <Badge variant={r.active ? "success" : "secondary"}>{r.active ? l.active : l.inactive}</Badge>
                    <Link href={`/vendor/reps/visits?rep=${r.id}`} className="text-sm underline-offset-2 hover:underline">{l.visitsTitle}</Link>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4 lg:grid-cols-8">
                    {([
                      [l.customers, String(r.customers), "sr-rep-customers"], [l.visitsDone, `${r.visitsDone} / ${r.visitsPlanned}`, "sr-rep-visits"], [l.repOrders, String(r.repOrders), "sr-rep-taken"], [l.pendingOrders, String(r.repOrdersPending), "sr-rep-pending"],
                      [l.orders, String(r.orders), "sr-rep-orders"], [l.deliveredNet, m(r.delivered), "sr-rep-delivered"], [`${l.commission} (${r.commissionPct} %)`, m(r.commission), "sr-rep-commission"],
                      [l.targetPct, r.targetPct == null ? l.noTarget : `${r.targetPct} %`, "sr-rep-target"],
                    ] as const).map(([k, v, id]) => <div key={id} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular-nums" data-testid={id}>{v}</dd></div>)}
                  </dl>
                  {r.monthlyTarget != null && <div className="space-y-1"><TargetBar pct={r.targetPct} /><p className="text-xs text-muted-foreground">{fill(l.toGo, { amount: m(Math.max(0, r.monthlyTarget - r.delivered)) })}</p></div>}
                  <RepForm l={l} rep={{ userId: r.userId, name: r.name, commissionPct: r.commissionPct, monthlyTarget: r.monthlyTarget, active: r.active }} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {s.enabled && (
        <Card>
          <CardHeader><CardTitle>{l.addRep}</CardTitle><CardDescription>{l.addRepHint}</CardDescription></CardHeader>
          <CardContent><RepForm l={l} candidates={t.candidates} /></CardContent>
        </Card>
      )}
    </>
  );
}
