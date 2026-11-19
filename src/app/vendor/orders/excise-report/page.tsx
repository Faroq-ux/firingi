import { FileSpreadsheet } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { exciseReport } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ExciseReportView } from "@/components/excise/views";
import { exLabels } from "@/components/excise/labels";

export const metadata = { title: "Excise Report" };
export const dynamic = "force-dynamic";

const months = () => [0, 1, 2, 3, 4, 5].map((k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });

export default async function VendorExciseReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage", "vendor.reports.view"]);
  const { l, locale } = await exLabels();
  const ms = months();
  const month = ms.includes((await searchParams).month ?? "") ? (await searchParams).month! : ms[0];
  const r = await exciseReport(ctx, month, locale);
  return (
    <>
      <PageHeader title={l.reportTitle} icon={FileSpreadsheet} description={l.reportIntro} />
      <Card><CardContent className="pt-5"><ExciseReportView r={r} l={l} locale={locale} months={ms} base="/vendor/orders/excise-report" /></CardContent></Card>
    </>
  );
}
