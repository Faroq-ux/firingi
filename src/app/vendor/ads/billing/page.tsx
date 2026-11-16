import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myAdBilling } from "@/server/ads/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Ad billing" };
export const dynamic = "force-dynamic";

export default async function AdBilling() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.invoices.view"]);
  const [b, t, locale] = await Promise.all([myAdBilling(ctx).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; }), getTranslations("ads"), getLocale()]);
  const money = (v: string | number) => formatMoney(String(v), locale);
  const prepaid = b.billing === "PREPAID" || Number(b.balance) > 0;
  return (
    <>
      <PageHeader title={t("billingTitle")} icon={Megaphone} description={t("billingIntro")} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card data-testid="billing-method"><CardHeader><CardTitle>{t(`billings.${b.billing}`)}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          <p>{t(`billing${b.billing}`)}</p>
          {prepaid && <p className="text-lg font-semibold" data-testid="ad-balance">{t("balance")}: {money(b.balance)}</p>}
          <p className="text-muted-foreground">{t("unbilled")}: {money(b.unbilled)}</p>
        </CardContent></Card>
        {b.billing === "PREPAID" && b.topUp.iban && (
          <Card data-testid="topup-info"><CardHeader><CardTitle>{t("topUpTitle")}</CardTitle></CardHeader><CardContent className="text-sm">
            <p className="break-words">{t("topUpText", { iban: b.topUp.iban, reference: b.topUp.reference })}</p>
          </CardContent></Card>
        )}
      </div>
      <h2 className="mb-2 text-lg font-semibold">{t("invoices")}</h2>
      <DataTable tableId="vendor.ads.invoices" testId="ad-invoices" empty={t("noInvoices")}
        columns={[{ key: "number", label: t("colInvoice") }, { key: "date", label: t("colDate"), type: "date" }, { key: "period", label: t("colPeriod") }, { key: "total", label: t("colTotal"), type: "number" }, { key: "open", label: t("colOpen"), type: "number" }]}
        rows={b.invoices.map((i) => ({
          id: i.id,
          cells: {
            number: { t: i.number ?? "—", mono: true, node: <a className="font-mono text-primary hover:underline" href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">{i.number ?? "—"}</a> },
            date: i.issuedAt.toISOString().slice(0, 10), period: i.kind === "TOPUP" ? t("topup") : i.period ?? "—",
            total: { t: money(i.gross), v: Number(i.gross) }, open: { t: money(i.open), v: Number(i.open), tone: Number(i.open) > 0 ? "warning" : undefined },
          },
        }))} />
    </>
  );
}
