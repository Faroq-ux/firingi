import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PayPanel } from "@/components/payments/pay-panel";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { payPageData } from "@/server/payments/view";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ return?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.payments.make", "buyer.payments.view", "buyer.invoices.view"]);
  const [{ id }, sp, t] = await Promise.all([params, searchParams, getTranslations("pay")]);
  const d = await payPageData({ ctx, id });
  const back = d.orderId ? `/buy/orders/${d.orderId}` : "/buy/finance/invoices";
  return (
    <>
      <Link href={back} className="mb-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden />{d.orderId ? d.view.orderNumber : t("backToInvoices")}</Link>
      <PageHeader title={t("title")} />
      <Card className="max-w-lg"><CardContent className="pt-5">
        <PayPanel request={d.view} methods={d.methods} mandateLast4={d.mandateLast4} providerLabel={d.providerLabel} via="portal" bankTransfer={d.bankTransfer} returning={sp.return === "1"} />
      </CardContent></Card>
    </>
  );
}
