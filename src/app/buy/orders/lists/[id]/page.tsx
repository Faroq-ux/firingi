import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { getList } from "@/server/buying/lists";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListActions, ListQty } from "@/components/buying/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Order list" };

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const l = await getList(ctx, (await params).id, locale);
  const total = l.lines.reduce((a, x) => a + (Number(x.unitNet) || 0) * x.qty, 0);
  return (
    <>
      <PageHeader title={l.name} actions={<Badge variant={l.shared ? "default" : "outline"}>{l.shared ? t("team") : t("private")}</Badge>} />
      <Card className="mb-6"><CardContent className="pt-6"><ListActions id={l.id} name={l.name} shared={l.shared} mine={l.mine} canDelete={l.mine || can(ctx, "buyer.orders.approve")} /></CardContent></Card>
      <Card>
        <CardContent className="pt-6">
          {l.lines.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyList")} <Link href="/buy/catalogue/browse" className="underline">{t("browse")}</Link></p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="list-lines">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("product")}</th><th className="py-1 pr-3 font-medium">{t("supplier")}</th><th className="py-1 pr-3 text-right font-medium">{t("unitPrice")}</th><th className="py-1 text-right font-medium">{t("qty")}</th></tr></thead>
                <tbody>
                  {l.lines.map((x) => (
                    <tr key={x.offerId} className="border-t">
                      <td className="py-2 pr-3"><Link href={`/buy/catalogue/offers/${x.offerId}`} className="font-medium hover:text-primary">{x.product}</Link><div className="text-xs text-muted-foreground">{x.packaging}{x.sku ? ` · ${x.sku}` : ""}{!x.available ? ` · ${t("notAvailable")}` : ""}</div></td>
                      <td className="py-2 pr-3">{x.supplier}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{x.unitNet ? formatMoney(x.unitNet, locale) : "—"}</td>
                      <td className="py-2 text-right"><ListQty id={l.id} offerId={x.offerId} qty={x.qty} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-right text-sm">{t("estimate")}: <b className="tabular-nums">{formatMoney(total, locale)}</b> <span className="text-muted-foreground">({t("exclVat")})</span></p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
