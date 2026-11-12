import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { cartView } from "@/server/services/cart";
import { orderingSettings } from "@/server/multisite/branches";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CartQty, CheckoutForm, ClearCartButton, CouponBox } from "@/components/orders/cart-controls";
import { COUPON_ERRORS } from "@/lib/coupons";
import { CartExtras } from "@/components/buying/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Cart" };

export default async function CartPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.orders.place");
  const [cart, t, tc, locale, ordering] = await Promise.all([cartView(ctx), getTranslations("orders"), getTranslations("coupons"), getLocale(), orderingSettings(ctx)]);
  const poRequired = ordering.requirePoReference;
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
  type G = (typeof cart.groups)[number];
  const deliveryNote = (g: G) => {
    const gd = g.delivery;
    if (!gd) return null;
    return gd.ok ? (
      <p className="rounded-md bg-muted p-2 text-sm" data-testid="group-delivery">
        {gd.mode === "FIRINGI_FLEET" ? t("deliveryFirINGI") : gd.mode === "CARRIER" ? t("deliveryCarrier") : t("deliveryVendor")}
        {g.freeDelivery ? <> · <b data-testid="free-delivery">{tc("freeDelivery")}</b></> : Number(gd.feeNet) === 0 ? <> · <b data-testid="free-delivery">{t("freeDelivery")}</b></> : <> · {t("fee")} {formatMoney(gd.feeNet, locale)}{gd.mode !== "FIRINGI_FLEET" ? <> · {t("supplierFlatRate")}</> : null}</>}
      </p>
    ) : (
      <p role="alert" className="rounded-md bg-warning/15 p-2 text-sm" data-testid="group-delivery">
        {gd.reason === "NOT_AVAILABLE_HERE" ? t("notAvailableHere") : "unit" in gd && gd.unit === "UNITS" ? t("belowSupplierUnits", { min: gd.minimum, missing: gd.missing }) : t(gd.reason === "BELOW_SUPPLIER_MINIMUM" ? "belowSupplierMin" : "belowMinimum", { min: formatMoney(gd.minimum, locale), missing: formatMoney(gd.missing, locale), tax })}
      </p>
    );
  };
  return (
    <>
      <PageHeader title={t("cart")} description={cart.routed ? <span data-testid="routed-cart">{t("routedCart")}</span> : cart.groups.length > 1 ? <span data-testid="split-note">{t("splitNote", { count: cart.groups.length })}</span> : <span>{t("supplier")}: <Link className="font-medium text-primary hover:underline" href={`/buy/catalogue/suppliers/${cart.groups[0].supplier.id}`}>{cart.groups[0].supplier.name}</Link></span>} actions={<ClearCartButton />} />
      {cart.unavailable.length > 0 && <p className="mb-4 rounded-md bg-warning/10 p-3 text-sm">{t("unavailable", { count: cart.unavailable.length })}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {cart.groups.map((g) => (
            <div key={g.supplier.id || "firingi"} className="space-y-2" data-testid="cart-group">
              {cart.groups.length > 1 && <h2 className="text-sm font-semibold text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]"><Link href={`/buy/catalogue/suppliers/${g.supplier.id}`} className="hover:underline">{g.supplier.name}</Link></h2>}
              <Table>
                <THead><TR><TH>{t("product")}</TH><TH className="text-right">{t("unitPrice")}</TH><TH className="text-right">{t("qty")}</TH><TH className="text-right">{t("lineTotal")}</TH></TR></THead>
                <TBody>
                  {g.lines.map((l) => (
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
              {cart.groups.length > 1 && deliveryNote(g)}
            </div>
          ))}
        </div>
        <Card>
          <CardHeader><CardTitle>{t("total")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("subtotal")} (s/ {tax})</dt><dd className="text-right tabular-nums">{formatMoney(Number(cart.goodsNet) + Number(cart.offerDiscount), locale)}</dd>
              {Number(cart.offerDiscount) > 0 && <><dt className="text-[color:color-mix(in_oklch,var(--vivid-pink)_80%,var(--foreground))]">{tc("offerDiscount")}</dt><dd className="text-right tabular-nums text-[color:color-mix(in_oklch,var(--vivid-pink)_80%,var(--foreground))]" data-testid="offer-discount">−{formatMoney(cart.offerDiscount, locale)}</dd></>}
              {d?.ok && <><dt className="text-muted-foreground">{t("fee")}</dt><dd className="text-right tabular-nums">{cart.freeDelivery ? <><s className="text-muted-foreground">{formatMoney(cart.freeDelivery.amount, locale)}</s> {formatMoney(d.feeNet, locale)}</> : formatMoney(d.feeNet, locale)}</dd></>}
              <dt className="text-muted-foreground">{tax}</dt><dd className="text-right tabular-nums">{formatMoney(cart.totalVat, locale)}</dd>
              <dt className="font-semibold">{t("total")} (c/ {tax})</dt><dd className="text-right text-lg font-semibold tabular-nums">{formatMoney(cart.totalGross, locale)}</dd>
            </dl>
            {cart.groups.length === 1 && deliveryNote(cart.groups[0])}
            {cart.groups.length > 1 && d && !d.ok && <p role="alert" className="rounded-md bg-warning/15 p-2 text-sm">{t("splitBlocked")}</p>}
            {cart.credit && (
              <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" data-testid="credit-block">
                {cart.credit.code === "PAYMENT_OVERDUE" ? t("creditOverdue", { days: cart.credit.days ?? 0 }) : t("creditLimit", { available: formatMoney(cart.credit.available ?? 0, locale), limit: formatMoney(cart.credit.limit ?? 0, locale) })}{" "}
                <Link href="/buy/finance/invoices" className="underline">{t("openInvoices")}</Link>
              </p>
            )}
            <CouponBox coupon={cart.coupon && {
              code: cart.coupon.code, ok: cart.coupon.ok, savings: cart.coupon.savings, savingsText: tc("saves", { amount: formatMoney(cart.coupon.savings, locale) }),
              errorText: cart.coupon.error ? ((COUPON_ERRORS as readonly string[]).includes(cart.coupon.error.code) ? tc(`errors.${cart.coupon.error.code}`, { missing: formatMoney(cart.coupon.error.details?.missing ?? 0, locale), min: formatMoney(cart.coupon.error.details?.minimum ?? 0, locale) }) : cart.coupon.error.message) : null,
            }} />
            <CheckoutForm disabled={!d?.ok || !!cart.credit || (!!cart.coupon && !cart.coupon.ok)} poRequired={poRequired} locale={locale} addresses={cart.addresses.map((a) => ({ id: a.id, label: `${a.label} — ${a.line1}, ${a.cityName}${(a as { branch?: { name: string } | null }).branch ? ` · ${(a as { branch?: { name: string } | null }).branch!.name}` : ""}` }))} />
            <CartExtras canQuote={!cart.routed} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
