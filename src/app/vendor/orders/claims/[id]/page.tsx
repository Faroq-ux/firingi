import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimDetail } from "@/server/claims/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHARGEBACK_TONE, ClaimLines, ClaimSummary, Conversation, DecisionCard, SupplierSide } from "@/components/claims/views";
import { DisputeChargeback, MessageForm, ReplacementDone, SupplierResponseForm } from "@/components/claims/forms";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quality Claim" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.claims.respond", "vendor.orders.view"]);
  const { id } = await params;
  const d = await claimDetail(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  if (d.as !== "VENDOR") notFound();
  const [t, locale] = await Promise.all([getTranslations("claims"), getLocale()]);
  return (
    <>
      <PageHeader title={t("detailTitle", { number: d.number })} description={t("detailIntroVendor", { customer: d.buyer.name })} icon={AlertTriangle} />
      <ClaimSummary d={d} t={t} locale={locale} orderHref={`/vendor/orders/${d.order.id}`} />
      <DecisionCard d={d} t={t} locale={locale} />
      {d.can.replace && (
        <Card className="mb-6 border-2 border-[color:color-mix(in_oklch,var(--vivid-blue)_45%,var(--border))]">
          <CardHeader><CardTitle>{t("replaceTitle")}</CardTitle><CardDescription>{t("replaceHint")}</CardDescription></CardHeader>
          <CardContent><ReplacementDone id={d.id} label={t("replaceDone")} /></CardContent>
        </Card>
      )}
      {d.chargebacks.length > 0 && (
        <Card className="mb-6" data-testid="vendor-chargebacks">
          <CardHeader><CardTitle>{t("chargeback.title")}</CardTitle><CardDescription>{t("chargeback.hint")}</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {d.chargebacks.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-semibold tabular-nums">{formatMoney(c.amount, locale)}</span>
                  <Badge variant={CHARGEBACK_TONE[c.status]}>{t(`chargeback.status.${c.status}`)}</Badge>
                  {c.deductedRef && <span className="text-xs text-muted-foreground">{c.deductedRef}</span>}
                  {c.disputeNote && <span className="min-w-0 flex-1 basis-48 break-words text-xs text-muted-foreground">{t("chargeback.yourNote")}: {c.disputeNote}</span>}
                  {c.resolutionNote && <span className="min-w-0 flex-1 basis-48 break-words text-xs text-muted-foreground">FIRINGI: {c.resolutionNote}</span>}
                  {c.status === "OPEN" && <DisputeChargeback id={c.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {d.can.respond && (
        <Card className="mb-6 border-2 border-[color:color-mix(in_oklch,var(--vivid-orange)_45%,var(--border))]">
          <CardHeader><CardTitle>{d.supplier.response ? t("respond.titleUpdate") : t("respond.title")}</CardTitle><CardDescription>{t("respond.hint")}</CardDescription></CardHeader>
          <CardContent><SupplierResponseForm claimId={d.id} current={d.supplier.response} /></CardContent>
        </Card>
      )}
      <ClaimLines d={d} t={t} locale={locale} />
      <SupplierSide d={d} t={t} locale={locale} />
      <Conversation d={d} t={t} locale={locale}>
        {d.can.message && d.status !== "WITHDRAWN" && <MessageForm claimId={d.id} labels={{ placeholder: t("messagePlaceholder"), send: t("send"), photos: t("addPhotos") }} />}
      </Conversation>
    </>
  );
}
