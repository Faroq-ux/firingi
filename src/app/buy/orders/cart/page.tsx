import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { cartView } from "@/server/services/cart";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CartQty, CheckoutForm, ClearCartButton } from "@/components/orders/cart-controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Cart" };

export default async function CartPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.orders.place");
  const [cart, t, locale] = await Promise.all([cartView(ctx), getTranslations("orders"), getLocale()]);
  const tax = cart.taxLabel;
  const L = (v: unknown) => pickLocalized(v, locale);
  if (cart.lines.length === 0)
    return (
      <>
        <PageHeader title={t("cart")} />
        <Card><CardContent className="space-y-4 py-12 text-center"><p className="text-muted-foreground">{t("emptyCart")}</p><Link href="/buy/catalogue/browse" className={buttonVariants()}>{t("continueShopping")}</Link></CardContent></Card>
      </>
    );
  const d = cart.delivery;
  return (
    <>
      <PageHeader title={t("cart")} description={cart.routed ? <span data-testid="routed-cart">{t("routedCart")}</span> : <span>{t("supplier")}: <Link className="font-medium text-primary hover:underline" href={`/buy/catalogue/suppliers/${cart.seller!.id}`}>{cart.seller!.name}</Link></span>} actions={<ClearCartButton />} />
      {cart.unavailable.length > 0 && <p className="mb-4 rounded-md bg-warning/10 p-3 text-sm">{t("unavailable", { count: cart.unavailable.length })}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table>
            <THead><TR><TH>{t("product")}</TH><TH className="text-right">{t("unitPrice")}</TH><TH className="text-right">{t("qty")}</TH><TH className="text-right">{t("lineTotal")}</TH></TR></THead>
            <TBody>
              {cart.lines.map((l) => (
                <TR key={l.offerId}>
                  <TD>
                    <Link href={`/buy/catalogue/offers/${l.offerId}`} className="font-medium hover:text-primary">{L(l.name)}</Link>
                    <div className="text-xs text-muted-foreground">{L(l.packaging.name)} · SKU {l.sku}{l.gtin ? ` · ${l.gtin}` : ""}</div>
                  </TD>
                  <TD className="text-right text-sm tabular-nums">{formatMoney(l.price!.unitPriceGross, locale)}<div className="text-xs text-muted-foreground">{formatMoney(l.price!.unitPriceNet, locale)} s/ {tax}</div></TD>
                  <TD><CartQty offerId={l.offerId} qty={l.qty} min={l.minOrderQty} step={l.qtyStep} /></TD>
                  <TD className="text-right tabular-nums">{formatMoney(l.lineGross, locale)}<div className="text-xs text-muted-foreground">{tax} {Number(l.vatRate)}%</div></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <Card>
          <CardHeader><CardTitle>{t("total")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("subtotal")} (s/ {tax})</dt><dd className="text-right tabular-nums">{formatMoney(cart.goodsNet, locale)}</dd>
              {d?.ok && <><dt className="text-muted-foreground">{t("fee")}</dt><dd className="text-right tabular-nums">{formatMoney(d.feeNet, locale)}</dd></>}
              <dt className="text-muted-foreground">{tax}</dt><dd className="text-right tabular-nums">{formatMoney(cart.totalVat, locale)}</dd>
              <dt className="font-semibold">{t("total")} (c/ {tax})</dt><dd className="text-right text-lg font-semibold tabular-nums">{formatMoney(cart.totalGross, locale)}</dd>
            </dl>
            {d && (d.ok ? (
              <p className="rounded-md bg-muted p-2 text-sm">
                {d.mode === "FIRINGI_FLEET" ? t("deliveryFirINGI") : d.mode === "CARRIER" ? t("deliveryCarrier") : t("deliveryVendor")}
                {Number(d.feeNet) === 0 ? <> · <b data-testid="free-delivery">{t("freeDelivery")}</b></> : d.mode !== "FIRINGI_FLEET" ? <> · {t("supplierFlatRate")}</> : null}
              </p>
            ) : (
              <p role="alert" className="rounded-md bg-warning/15 p-2 text-sm">
                {d.reason === "NOT_AVAILABLE_HERE" ? t("notAvailableHere") : "unit" in d && d.unit === "UNITS" ? t("belowSupplierUnits", { min: d.minimum, missing: d.missing }) : t(d.reason === "BELOW_SUPPLIER_MINIMUM" ? "belowSupplierMin" : "belowMinimum", { min: formatMoney(d.minimum, locale), missing: formatMoney(d.missing, locale), tax })}
              </p>
            ))}
            {cart.credit && (
              <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" data-testid="credit-block">
                {cart.credit.code === "PAYMENT_OVERDUE" ? t("creditOverdue", { days: cart.credit.days ?? 0 }) : t("creditLimit", { available: formatMoney(cart.credit.available ?? 0, locale), limit: formatMoney(cart.credit.limit ?? 0, locale) })}{" "}
                <Link href="/buy/finance/invoices" className="underline">{t("openInvoices")}</Link>
              </p>
            )}
            <CheckoutForm disabled={!d?.ok || !!cart.credit} addresses={cart.addresses.map((a) => ({ id: a.id, label: `${a.label} — ${a.line1}, ${a.cityName}` }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
