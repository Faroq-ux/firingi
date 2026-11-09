/** Order list and order detail, shared by buyer, vendor and admin screens. */
import Link from "next/link";
import type { OrderStatus } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { getOrder, listOrders, type OrderRole } from "@/server/services/orders";
import { pickLocalized } from "@/i18n/config";
import { taxLabel } from "@/lib/tax-label";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { ResolveException, StatusActions } from "./order-actions";
import { DecisionPanel } from "./decision-panel";
import { openBuyerDecision } from "@/server/allocation/engine";
import { allocationRules } from "@/server/allocation/rules";
import { DeliveryPanel, OrderReturnsPanel } from "@/components/delivery/delivery-views";

const STATUS_VARIANT: Record<OrderStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  NEW: "secondary", PENDING_CONFIRMATION: "warning", SUPPLIER_PROCESSING: "default", READY_FOR_PICKUP: "default", DISPATCHED: "default",
  OUT_FOR_DELIVERY: "default", DELIVERED: "success", CANCELLED: "secondary", RETURNED: "secondary", EXCEPTION: "destructive",
};

export async function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = await getTranslations("orders.statuses");
  return <Badge variant={STATUS_VARIANT[status]}>{t(status)}</Badge>;
}

const BASE: Record<OrderRole, string> = { BUYER: "/buy/orders", VENDOR: "/vendor/orders", ADMIN: "/admin/orders" };

export async function OrderList({ ctx, as, title, description, statuses, since, sellerType, withOpenExceptions, params, basePath }: {
  ctx: Ctx; as: OrderRole; title: string; description?: string; statuses?: OrderStatus[]; since?: Date; sellerType?: "DISTRIBUTOR" | "WHOLESALER";
  withOpenExceptions?: boolean; params: { q?: string; page?: string }; basePath: string;
}) {
  const [data, t, c, locale] = await Promise.all([
    listOrders(ctx, as, { statuses, since, sellerType, withOpenExceptions, q: params.q, page: Number(params.page) || 1 }),
    getTranslations("orders"), getTranslations("common"), getLocale(),
  ]);
  return (
    <>
      <PageHeader title={title} description={description ?? `${data.total}`} />
      <form className="mb-4 flex gap-2" action={basePath}>
        <Input name="q" defaultValue={params.q} placeholder={c("search")} className="w-64" />
        <Button type="submit" variant="outline">{c("filter")}</Button>
      </form>
      <Table>
        <THead><TR><TH>{t("order")}</TH><TH>{t("date")}</TH>{as !== "BUYER" && <TH>{t("vendor.buyer")}</TH>}{as !== "VENDOR" && <TH>{t("supplier")}</TH>}<TH>{t("delivery")}</TH><TH className="text-right">{t("total")}</TH><TH>{t("status")}</TH></TR></THead>
        <TBody>
          {data.rows.length === 0 && <EmptyRow colSpan={7}>{t("noOrders")}</EmptyRow>}
          {data.rows.map((o) => (
            <TR key={o.id}>
              <TD><Link href={`${BASE[as]}/${o.id}`} className="font-mono font-medium text-primary hover:underline">{o.number}</Link>{o._count.exceptions > 0 && <Badge variant="destructive" className="ml-1">!</Badge>}</TD>
              <TD className="text-xs text-muted-foreground">{formatDate(o.placedAt, locale, true)}</TD>
              {as !== "BUYER" && <TD>{o.buyer.tradeName ?? o.buyer.legalName}</TD>}
              {as !== "VENDOR" && <TD>{o.seller.tradeName ?? o.seller.legalName}</TD>}
              <TD className="text-xs">{o.deliveryMode ? t(`modes.${o.deliveryMode}`) : "—"}</TD>
              <TD className="text-right tabular-nums">{formatMoney(o.grandTotal.toString(), locale)}</TD>
              <TD><OrderStatusBadge status={o.status} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="mt-3 text-sm text-muted-foreground">{c("pageOf", { page: data.page, count: data.pageCount })}</p>
    </>
  );
}

export async function OrderDetail({ ctx, id, placed }: { ctx: Ctx; id: string; placed?: boolean }) {
  const { order: o, role, actors, allowed } = await getOrder(ctx, id);
  const [t, locale] = await Promise.all([getTranslations("orders"), getLocale()]);
  const decision = role === "BUYER" ? await openBuyerDecision(ctx, o.id) : null;
  const rules = decision ? await allocationRules() : null;
  const tax = taxLabel((o.deliveryAddress as { country?: string }).country ?? ctx.company.countryCode);
  const addr = o.deliveryAddress as { label?: string; line1?: string; line2?: string; postalCode?: string; city?: string; country?: string };
  const goodsNet = o.lines.reduce((a, l) => a + Number(l.lineNet), 0);
  const L = (v: unknown) => pickLocalized(v, locale);
  return (
    <>
      <Link href={BASE[role]} className="text-sm text-primary hover:underline">← {role === "BUYER" ? t("myOrders") : t("vendor.all")}</Link>
      <PageHeader
        title={`${t("order")} ${o.number}`}
        description={<span className="flex flex-wrap items-center gap-2"><OrderStatusBadge status={o.status} /> {formatDate(o.placedAt, locale, true)} · {o.deliveryMode && t(`modes.${o.deliveryMode}`)}{role === "VENDOR" && o.routedByFiringi && <Badge data-testid="routed-badge">{t("deliveryOrderFromFiringi")}</Badge>}</span>}
        actions={role === "VENDOR" ? <Link className={buttonVariants({ variant: "outline" })} href={`/vendor/orders/${o.id}/delivery-order`} data-testid="delivery-order-link">{t("deliveryOrder")}</Link> : undefined}
      />
      {decision && rules && (
        <DecisionPanel eventId={decision.id} shortfall={decision.trigger === "SHORTFALL"} supplier={o.seller.tradeName ?? o.seller.legalName}
          deadline={formatDate(new Date(decision.createdAt.getTime() + rules.buyerDecisionHours * 3600_000), locale, true)} />
      )}
      {placed && <p className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">{t("orderPlaced", { number: o.number })}</p>}
      {o.parentOrder && (
        <p className="mb-4 rounded-md border bg-card p-3 text-sm" data-testid="moved-from">
          {role === "VENDOR" ? t("passedOn") : (
            <Link className="hover:underline" href={`${BASE[role]}/${o.parentOrder.id}`}>{t("movedFrom", { number: o.parentOrder.number })}</Link>
          )}
        </p>
      )}
      {o.childOrders.length > 0 && role !== "VENDOR" && (
        <div className="mb-4 rounded-md border bg-card p-3 text-sm" data-testid="moved-to">
          <p>{t("movedTo")}</p>
          <ul className="mt-1 space-y-1">
            {o.childOrders.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Link className="font-medium text-primary hover:underline" href={`${BASE[role]}/${c.id}`}>{c.number}</Link>
                <span>{c.seller.tradeName ?? c.seller.legalName}</span>
                <OrderStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
          {role === "ADMIN" && <Link className="mt-2 inline-block text-xs text-primary hover:underline" href={`/admin/allocation/allocation-history?order=${o.id}`}>Allocation history →</Link>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="pt-5">
              <Table>
                <THead><TR><TH>{t("product")}</TH><TH className="text-right">{t("ordered")}</TH><TH className="text-right">{t("confirmedQty")}</TH><TH className="text-right">{t("unitPrice")}</TH><TH className="text-right">{tax}</TH><TH className="text-right">{t("lineTotal")}</TH></TR></THead>
                <TBody>
                  {o.lines.map((l) => (
                    <TR key={l.id}>
                      <TD><div className="font-medium">{L(l.productName)}</div><div className="text-xs text-muted-foreground">{L(l.packagingName)} · SKU {l.sku}</div></TD>
                      <TD className="text-right tabular-nums">{l.qtyOrdered}</TD>
                      <TD className="text-right tabular-nums">{l.qtyConfirmed ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(l.unitSalePriceNet.toString(), locale)}</TD>
                      <TD className="text-right tabular-nums">{Number(l.taxRate)}%</TD>
                      <TD className="text-right tabular-nums">{formatMoney(l.lineNet.toString(), locale)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("subtotal")}</dt><dd className="text-right tabular-nums">{formatMoney(goodsNet, locale)}</dd>
                <dt className="text-muted-foreground">{t("fee")}</dt><dd className="text-right tabular-nums">{formatMoney(o.deliveryFeeNet.toString(), locale)}</dd>
                <dt className="text-muted-foreground">{tax}</dt><dd className="text-right tabular-nums">{formatMoney(o.vatTotal.toString(), locale)}</dd>
                <dt className="font-semibold">{t("total")} ({t("vatIncluded", { tax })})</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(o.grandTotal.toString(), locale)}</dd>
                {role !== "BUYER" && (<>
                  <dt className="pt-2 text-muted-foreground">{t("vendor.commission")}</dt><dd className="pt-2 text-right tabular-nums">{formatMoney(o.commissionTotal.toString(), locale)}</dd>
                  <dt className="text-muted-foreground">{t("vendor.yourPayout")}</dt><dd className="text-right tabular-nums">{formatMoney(o.vendorPayableNet.toString(), locale)}</dd>
                </>)}
              </dl>
            </CardContent>
          </Card>
          <OrderReturnsPanel ctx={ctx} orderId={o.id} role={role} />
          {o.exceptions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Exceptions</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {o.exceptions.map((e) => (
                  <div key={e.id} className="rounded-md border p-2">
                    <div className="flex justify-between"><Badge variant={e.isResolved ? "success" : "destructive"}>{e.isResolved ? "resolved" : "open"}</Badge><span className="text-xs text-muted-foreground">{formatDate(e.createdAt, locale, true)}</span></div>
                    <p className="mt-1 whitespace-pre-line">{e.description}</p>
                    {role === "ADMIN" && !e.isResolved && <div className="mt-2"><ResolveException exceptionId={e.id} /></div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {allowed.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("status")}</CardTitle></CardHeader>
              <CardContent>
                <StatusActions
                  orderId={o.id}
                  allowed={allowed as never}
                  confirmLines={role !== "BUYER" && o.status === "PENDING_CONFIRMATION" ? o.lines.map((l) => ({ id: l.id, label: `${L(l.productName)} · ${L(l.packagingName)}`, qty: l.qtyOrdered })) : undefined}
                />
              </CardContent>
            </Card>
          )}
          <DeliveryPanel ctx={ctx} orderId={o.id} />
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <div><div className="text-muted-foreground">{t("supplier")}</div><div className="font-medium">{o.seller.tradeName ?? o.seller.legalName}</div></div>
              <div><div className="text-muted-foreground">{t("vendor.buyer")}</div><div className="font-medium">{o.buyer.tradeName ?? o.buyer.legalName}</div><div className="text-xs text-muted-foreground">{o.placedBy.name}</div></div>
              <div><div className="text-muted-foreground">{t("deliveryTo")}</div><div>{addr.label}</div><div className="text-muted-foreground">{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}, {addr.postalCode} {addr.city}</div></div>
              {o.requestedDeliveryDate && <div><div className="text-muted-foreground">{t("requestedDate")}</div><div>{formatDate(o.requestedDeliveryDate, locale)}</div></div>}
              {o.buyerNotes && <div><div className="text-muted-foreground">{t("notes")}</div><div className="whitespace-pre-line">{o.buyerNotes}</div></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("history")}</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4 text-sm">
                {o.statusHistory.map((h) => (
                  <li key={h.id}>
                    <div className="font-medium">{t(`statuses.${h.toStatus}`)}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(h.at, locale, true)}{h.byUserId ? ` · ${actors.get(h.byUserId) ?? ""}` : ""}</div>
                    {h.reason && <div className="text-xs">{h.reason}</div>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
