import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { FileDown } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { firingiSources, getPurchaseOrder, listSuppliers } from "@/server/inventory/purchasing";
import { deliveryAddressOptions, offerLabel, offerOptions, warehouseOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PoActions, PoForm, ReceivePoForm } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.purchasing.manage", "vendor.inventory.view", "vendor.inventory.manage"]);
  const { id } = await params;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const po = await getPurchaseOrder(ctx, id).catch(() => null);
  if (!po) notFound();
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const from = po.supplier?.name ?? po.seller?.tradeName ?? po.seller?.legalName ?? "—";
  const edit = po.canEdit ? await Promise.all([listSuppliers(ctx), firingiSources(ctx), offerOptions(ctx, locale), warehouseOptions(ctx)]) : null;
  const deliveries = po.canSend && po.sellerCompanyId ? await deliveryAddressOptions(ctx) : [];
  return (
    <>
      <PageHeader title={po.number} description={`${t("from")}: ${from}${po.sellerCompanyId ? " · FIRINGI" : ""} · ${t("receiveInto")}: ${po.address.label}`}
        actions={<>
          <Badge variant={po.status === "RECEIVED" ? "success" : po.status === "CANCELLED" ? "outline" : po.status === "PARTIALLY_RECEIVED" ? "warning" : "secondary"} data-testid="po-status">{t(`po.${po.status}`)}</Badge>
          {!po.sellerCompanyId && <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/inventory/purchase-orders/${po.id}/pdf`} target="_blank" rel="noreferrer"><FileDown className="size-4" />{t("pdf")}</a>}
          <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/vendor/inventory/purchase-orders">← {t("purchaseOrders")}</Link>
        </>} />
      <div className="space-y-6">
        {po.viaOrder && (
          <p className="text-sm">{t("placed", { number: po.viaOrder.number })} <Link className="font-medium text-primary hover:underline" href={`/buy/orders/${po.viaOrder.id}`}>{po.viaOrder.number} →</Link></p>
        )}
        {po.waitingDelivery && <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground" data-testid="po-waiting">{t("waitingDelivery", { number: po.viaOrder!.number })}</p>}
        {edit ? (
          <Card><CardHeader><CardTitle>{t("po.DRAFT")}</CardTitle></CardHeader><CardContent>
            <PoForm suppliers={edit[0].map((s) => ({ id: s.id, label: s.name }))} offers={edit[2]} warehouses={edit[3]}
              sources={edit[1].map((d) => ({ id: d.id, name: d.tradeName ?? d.legalName, offers: d.vendorOffers.map((o) => ({ id: o.id, label: offerLabel(o.packaging.variant.product.name, o.packaging.name, o.vendorSku, locale) })) }))}
              initial={{ id: po.id, supplierId: po.supplierId, sellerCompanyId: po.sellerCompanyId, addressId: po.addressId, expectedOn: iso(po.expectedOn), notes: po.notes, lines: po.lines.map((l) => ({ offerId: l.offerId, qty: l.qty, unitCost: l.unitCost.toString(), sourceOfferId: l.sourceOfferId })) }} />
          </CardContent></Card>
        ) : (
          <Table smart={false} data-testid="po-lines">
            <THead><TR><TH>{t("product")}</TH><TH className="text-right">{t("ordered")}</TH><TH className="text-right">{t("received")}</TH><TH className="text-right">{t("unitCost")}</TH><TH className="text-right">{t("total")}</TH></TR></THead>
            <TBody>
              {po.lines.map((l) => (
                <TR key={l.id}><TD>{l.description}</TD><TD className="text-right tabular-nums">{l.qty}</TD><TD className="text-right tabular-nums">{l.receivedQty}</TD><TD className="text-right tabular-nums">{formatMoney(l.unitCost.toString(), locale)}</TD><TD className="text-right tabular-nums">{formatMoney(l.unitCost.mul(l.qty).toFixed(2), locale)}</TD></TR>
              ))}
              <TR><TD colSpan={4} className="text-right font-semibold">{t("total")}</TD><TD className="text-right font-semibold tabular-nums">{formatMoney(po.total, locale)}</TD></TR>
            </TBody>
          </Table>
        )}
        <PoActions id={po.id} canSend={po.canSend} canCancel={po.canCancel} viaFiringi={!!po.sellerCompanyId} supplierEmail={po.supplier?.email ?? null} deliveryAddresses={deliveries} />
        {po.canReceive && (
          <Card><CardHeader><CardTitle>{t("receiveNow")}</CardTitle>{po.expectedOn && <CardDescription>{t("expected")}: {date.format(po.expectedOn)}</CardDescription>}</CardHeader>
            <CardContent><ReceivePoForm poId={po.id} viaFiringi={!!po.sellerCompanyId} lines={po.lines.map((l) => ({ id: l.id, label: l.description, open: po.toReceive.find((x) => x.lineId === l.id)?.open ?? 0, unitCost: l.unitCost.toString() })).filter((l) => l.open > 0)} /></CardContent></Card>
        )}
        {po.receipts.length > 0 && (
          <Card><CardHeader><CardTitle>{t("receipts")}</CardTitle></CardHeader><CardContent className="space-y-2">
            {po.receipts.map((r) => (
              <div key={r.id} className="rounded-xl border p-3 text-sm">
                <div className="font-medium">{date.format(r.at)} · {r.by}</div>
                <ul className="mt-1 text-muted-foreground">{r.lines.map((l) => <li key={l.id}>{po.lines.find((x) => x.id === l.poLineId)?.description} — {l.qty}{l.lotCode ? ` · ${t("lot")} ${l.lotCode}` : ""}{l.expiresOn ? ` · ${t("bestBefore")} ${date.format(l.expiresOn)}` : ""}</li>)}</ul>
              </div>
            ))}
          </CardContent></Card>
        )}
      </div>
    </>
  );
}
