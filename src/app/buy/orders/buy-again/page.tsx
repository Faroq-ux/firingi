import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { reorderPredictions } from "@/server/ai/insights";
import { PageHeader } from "@/components/layout/page-header";
import { UsualOrder } from "@/components/ai/portal-cards";

export const metadata = { title: "Buy Again" };

/** The buyer's usual orders per supplier, latest-due first; one tap puts them in the cart. */
export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.orders.place");
  const [t, locale] = await Promise.all([getTranslations("ai"), getLocale()]);
  const rows = await reorderPredictions(ctx, "BUYER", { locale });
  return (
    <>
      <PageHeader title={t("buyAgain.title")} description={t("buyAgain.description")} />
      <div className="grid gap-3 lg:grid-cols-2" data-testid="buy-again-list">
        {rows.map((r) => <UsualOrder key={r.sellerId} r={r} locale={locale} />)}
      </div>
      {!rows.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="buy-again-empty">{t("buyAgain.empty")}</p>}
    </>
  );
}
