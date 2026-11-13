import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimDetail } from "@/server/claims/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { ClaimLines, ClaimSummary, Conversation, DecisionCard, SupplierSide } from "@/components/claims/views";
import { MessageForm, WithdrawClaim } from "@/components/claims/forms";

export const metadata = { title: "Quality Claim" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.claims.manage", "buyer.orders.view"]);
  const { id } = await params;
  const d = await claimDetail(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  if (d.as !== "BUYER") notFound();
  const [t, locale] = await Promise.all([getTranslations("claims"), getLocale()]);
  return (
    <>
      <PageHeader title={t("detailTitle", { number: d.number })} description={t("detailIntroBuyer", { supplier: d.seller.name })} icon={ShieldAlert} actions={d.can.withdraw ? <WithdrawClaim id={d.id} /> : undefined} />
      <ClaimSummary d={d} t={t} locale={locale} orderHref={`/buy/orders/${d.order.id}`} />
      <DecisionCard d={d} t={t} locale={locale} creditNoteHref={d.decision?.creditNoteId ? `/api/invoices/${d.decision.creditNoteId}/pdf` : undefined} />
      <ClaimLines d={d} t={t} locale={locale} />
      <SupplierSide d={d} t={t} locale={locale} />
      <Conversation d={d} t={t} locale={locale}>
        {d.can.message && d.status !== "WITHDRAWN" && <MessageForm claimId={d.id} labels={{ placeholder: t("messagePlaceholder"), send: t("send"), photos: t("addPhotos") }} />}
      </Conversation>
    </>
  );
}
