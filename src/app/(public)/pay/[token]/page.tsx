import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { PayPanel } from "@/components/payments/pay-panel";
import { payPageData } from "@/server/payments/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay", robots: { index: false, follow: false } };

/** Public pay link (from an e-mail / WhatsApp message): no sign-in, only this payment. */
export default async function PayLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ return?: string }> }) {
  const [{ token }, sp, t] = await Promise.all([params, searchParams, getTranslations("pay")]);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const d = await payPageData({ token }).catch(() => null);
  if (!d) notFound();
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground" data-testid="pay-company">{t("linkFor", { company: d.view.company })}</p>
        </div>
        <PayPanel request={d.view} methods={d.methods} mandateLast4={null} providerLabel={d.providerLabel} via="link" bankTransfer={d.bankTransfer} returning={sp.return === "1"} />
      </CardContent>
    </Card>
  );
}
