import { Leaf } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { co2ReportFor, co2Settings } from "@/server/co2/service";
import { PageHeader } from "@/components/layout/page-header";
import { co2Labels } from "@/components/co2/labels";
import { Co2Report } from "@/components/co2/report";

export const metadata = { title: "CO₂ Footprint" };
export const dynamic = "force-dynamic";

export default async function VendorCo2ReportPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.reports.view", "vendor.orders.view", "vendor.products.manage"]);
  const now = new Date().getUTCFullYear();
  const year = Math.min(now, Math.max(2020, Number((await searchParams).year) || now));
  const [{ l, locale }, s] = await Promise.all([co2Labels(), co2Settings()]);
  if (!s.enabled || !s.show.reports) return (<><PageHeader title={l.vendorReportTitle} icon={Leaf} description={l.vendorReportIntro} /><p className="rounded-xl border border-dashed p-6 text-center text-sm" data-testid="co2-closed">{l["closed.OFF"]}</p></>);
  const r = await co2ReportFor(ctx, "VENDOR", year, locale);
  return (
    <>
      <PageHeader title={l.vendorReportTitle} icon={Leaf} description={l.vendorReportIntro} />
      <Co2Report r={r} l={l} locale={locale} exportBase={`/api/co2/export?side=VENDOR&year=${year}`} partyLabel={l.byCustomer} years={[now - 2, now - 1, now]} yearHref={(y) => `?year=${y}`} />
    </>
  );
}
