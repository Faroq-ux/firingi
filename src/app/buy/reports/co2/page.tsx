import { Leaf } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { co2Access, co2ReportFor, co2Settings, myGoal } from "@/server/co2/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { co2Labels } from "@/components/co2/labels";
import { Co2Report } from "@/components/co2/report";
import { GoalForm } from "@/components/co2/client";

export const metadata = { title: "CO₂ Footprint" };
export const dynamic = "force-dynamic";

export default async function BuyerCo2Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.reports.view", "buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"]);
  const now = new Date().getUTCFullYear();
  const year = Math.min(now, Math.max(2020, Number((await searchParams).year) || now));
  const [{ l, locale }, s] = await Promise.all([co2Labels(), co2Settings()]);
  const a = await co2Access(ctx.company, s);
  if (!a.buyer || !s.show.reports) return (<><PageHeader title={l.buyerTitle} icon={Leaf} description={l.buyerIntro} /><p className="rounded-xl border border-dashed p-6 text-center text-sm" data-testid="co2-closed">{l[`closed.${a.why ?? "OFF"}`] ?? l["closed.OFF"]}</p></>);
  const r = await co2ReportFor(ctx, "BUYER", year, locale);
  const goal = s.show.goals ? await myGoal(ctx, year) : null;
  return (
    <>
      <PageHeader title={l.buyerTitle} icon={Leaf} description={l.buyerIntro} />
      {s.show.goals && (ctx.membership.isOwner || ctx.permissions.has("company.profile.manage") || ctx.permissions.has("buyer.orders.place")) && (
        <Card className="mb-6"><CardHeader className="pb-2"><CardTitle className="text-base">{l.goalTitle}</CardTitle></CardHeader><CardContent><GoalForm l={l} year={year} current={goal} /></CardContent></Card>
      )}
      <Co2Report r={r} l={l} locale={locale} exportBase={`/api/co2/export?side=BUYER&year=${year}`} partyLabel={l.bySupplier} years={[now - 2, now - 1, now]} yearHref={(y) => `?year=${y}`} />
    </>
  );
}
