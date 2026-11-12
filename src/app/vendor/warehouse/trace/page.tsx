import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { featureOn } from "@/server/warehouse/features";
import { FeatureOff } from "@/components/warehouse/feature-off";
import { traceLot } from "@/server/warehouse/recalls";
import { offerOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecallForm, TracePicker } from "@/components/warehouse/controls";
import { TraceView } from "@/components/warehouse/trace-view";
import { AppError } from "@/server/errors";

export const metadata = { title: "Traceability" };

export default async function TracePage({ searchParams }: { searchParams: Promise<{ offer?: string; lot?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  if (!(await featureOn(ctx, "TRACE"))) return <FeatureOff title={t("traceTitle")} />;
  const offers = await offerOptions(ctx, locale);
  let data: Awaited<ReturnType<typeof traceLot>> | null = null, error: string | null = null;
  if (sp.offer && sp.lot) {
    try { data = await traceLot(ctx, { offerId: sp.offer, lotCode: sp.lot }, locale); } catch (e) { if (e instanceof AppError) error = e.message; else throw e; }
  }
  const open = data?.recalls.find((r) => r.status === "OPEN");
  const recallsOn = await featureOn(ctx, "RECALLS");
  return (
    <>
      <PageHeader title={t("traceTitle")} description={t("traceIntro")} />
      <Card className="mb-6"><CardContent className="pt-6"><TracePicker offers={offers} offerId={sp.offer} lotCode={sp.lot} base="/vendor/warehouse/trace" /></CardContent></Card>
      {error && <p className="mb-4 text-sm text-destructive" role="alert">{error}</p>}
      {data && <TraceView data={data} t={t as never} locale={locale} orderHref={(id, mine) => (mine ? `/vendor/orders/${id}` : null)} />}
      {data && can(ctx, "vendor.recalls.manage") && recallsOn && (
        open ? (
          <p className="mt-6 text-sm"><Link className="font-medium text-destructive underline" href={`/vendor/warehouse/recalls/${open.id}`}>{t("openRecall", { number: open.number })}</Link></p>
        ) : (
          <Card className="mt-6 border-destructive/40" data-testid="recall-card">
            <CardHeader><CardTitle>{t("recallThisLot")}</CardTitle><CardDescription>{t("recallExplain")}</CardDescription></CardHeader>
            <CardContent><RecallForm offerId={data.product.id} lotCode={data.lotCode ?? sp.lot!} base="/vendor/warehouse/recalls" units={data.levels[0]?.stockUnits ?? 0} /></CardContent>
          </Card>
        )
      )}
    </>
  );
}
