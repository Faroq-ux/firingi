import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { movements, ownOffer, stockOverview } from "@/server/inventory/service";
import { offerOptions, warehouseOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { OpeningCostForm, ReceiveForm, ReorderForm, WriteOffButton } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Stock" };

export default async function ProductStock({ params }: { params: Promise<{ offerId: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const { offerId } = await params;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  if (!(await ownOffer(ctx, offerId).then(() => true).catch(() => false))) notFound();
  const [rows, whs, moves, offers] = await Promise.all([
    stockOverview(ctx).then((all) => all.filter((r) => r.offer.id === offerId)), warehouseOptions(ctx), movements(ctx, { offerId, take: 50 }), offerOptions(ctx, locale),
  ]);
  const manage = can(ctx, "vendor.inventory.manage");
  const title = offers.find((o) => o.id === offerId)?.label ?? t("stock");
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  const when = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title={title} description={t("method")} actions={<Link className="text-sm underline-offset-4 hover:underline" href="/vendor/inventory/overview">← {t("stock")}</Link>} />
      <div className="space-y-6">
        {rows.map((r) => (
          <Card key={r.addressId} data-testid="stock-warehouse">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{r.warehouse}<Badge variant={r.status === "OK" ? "success" : r.status === "LOW" || r.status === "EXPIRING" ? "warning" : "destructive"}>{t(`status.${r.status}`)}</Badge></CardTitle>
              <CardDescription>{t("onHand")} {r.onHand} · {t("reserved")} {r.reserved} · {t("free")} {r.usable}{r.incoming ? ` · ${t("incoming")} ${r.incoming}` : ""} · {t("avgCost")} {Number(r.avgCost) ? formatMoney(r.avgCost, locale) : "—"} · {t("value")} {formatMoney(r.value, locale)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table smart={false}>
                <THead><TR><TH>{t("lot")}</TH><TH>{t("bestBefore")}</TH><TH className="text-right">{t("onHand")}</TH><TH className="text-right">{t("reserved")}</TH><TH>{t("type")}</TH><TH /></TR></THead>
                <TBody>
                  {r.batches.map((b) => (
                    <TR key={b.id} data-testid="batch-row">
                      <TD className="font-medium">{b.lotCode ?? <span className="text-muted-foreground">{t("noLot")}</span>}</TD>
                      <TD>{b.expiresOn ? <span className={b.daysLeft !== null && b.daysLeft < 0 ? "text-destructive" : b.daysLeft !== null && b.daysLeft <= 14 ? "text-[color:var(--vivid-orange)]" : ""}>{date.format(b.expiresOn)} · {t("daysLeft", { days: b.daysLeft ?? 0 })}</span> : "—"}</TD>
                      <TD className="text-right tabular-nums">{b.onHand}</TD>
                      <TD className="text-right tabular-nums">{b.reserved || ""}</TD>
                      <TD className="text-xs text-muted-foreground">{t(`source.${b.source}`)}</TD>
                      <TD className="text-right">{manage && <WriteOffButton batchId={b.id} max={b.onHand - b.reserved} />}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {manage && (
                <div className="flex flex-wrap items-end gap-6">
                  <div><p className="mb-1 text-sm font-medium">{t("reorder")}</p><ReorderForm offerId={offerId} addressId={r.addressId} reorderPoint={r.reorderPoint} reorderQty={r.reorderQty} /></div>
                  {r.onHand > 0 && Number(r.avgCost) === 0 && <div><p className="mb-1 max-w-sm text-xs text-muted-foreground">{t("openingCostHint")}</p><OpeningCostForm offerId={offerId} addressId={r.addressId} /></div>}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {manage && (
          <Card><CardHeader><CardTitle>{t("receiveTitle")}</CardTitle><CardDescription>{t("receiveHint")}</CardDescription></CardHeader>
            <CardContent><ReceiveForm offers={[]} warehouses={whs} offerId={offerId} /></CardContent></Card>
        )}
        <Card>
          <CardHeader><CardTitle>{t("movements")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>{t("date")}</TH><TH>{t("type")}</TH><TH>{t("warehouse")}</TH><TH>{t("lot")}</TH><TH className="text-right">{t("qty")}</TH><TH className="text-right">{t("value")}</TH><TH>{t("reference")}</TH></TR></THead>
              <TBody>
                {moves.map((m) => (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap">{when.format(m.at)}</TD><TD>{t(`move.${m.type}`)}</TD><TD>{m.warehouse}</TD><TD>{m.lotCode ?? ""}</TD>
                    <TD className={`text-right tabular-nums ${m.qty < 0 ? "text-destructive" : ""}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TD>
                    <TD className="text-right tabular-nums">{m.value ? formatMoney(m.value, locale) : ""}</TD>
                    <TD>{m.order ? <Link className="hover:underline" href={`/vendor/orders/${m.order.id}`}>{m.order.number}</Link> : m.note ?? ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
