import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BadgePercent, Gift, Package, Ticket, Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myOffers, type MyOffer } from "@/server/marketing/my-offers";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { UseCoupon } from "@/components/marketing/use-coupon";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "My Offers" };

const TONES = ["tone-pink", "tone-violet", "tone-teal", "tone-orange", "tone-blue", "tone-lime"];
const ICON: Record<string, typeof Gift> = { PERCENT: BadgePercent, FIXED_AMOUNT: BadgePercent, ORDER_AMOUNT: Gift, FREE_DELIVERY: Truck, BUY_X_GET_Y: Package };

export default async function MyOffersPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.catalogue.view", "buyer.orders.place"]);
  const [offers, t, locale] = await Promise.all([myOffers(ctx), getTranslations("offers"), getLocale()]);
  const L = (v: unknown) => pickLocalized(v, locale);
  const headline = (o: MyOffer) =>
    o.kind === "PERCENT" ? t("kind.PERCENT", { value: Number(o.value) })
      : o.kind === "FIXED_AMOUNT" ? t("kind.FIXED_AMOUNT", { value: formatMoney(o.value, locale) })
        : o.kind === "ORDER_AMOUNT" ? t("kind.ORDER_AMOUNT", { value: formatMoney(o.value, locale) })
          : o.kind === "BUY_X_GET_Y" ? t("kind.BUY_X_GET_Y", { buy: o.buyQty ?? 0, free: o.freeQty ?? 0 })
            : t("kind.FREE_DELIVERY");
  const shopHref = (o: MyOffer) => o.target?.categoryId ? `/buy/catalogue/browse?category=${o.target.categoryId}` : o.target?.vendorId ? `/buy/catalogue/suppliers/${o.target.vendorId}` : "/buy/catalogue/browse";
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {offers.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("empty")}</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="my-offers">
          {offers.map((o, i) => {
            const Icon = o.code ? Ticket : ICON[o.kind] ?? Gift;
            return (
              <div key={o.id} className={`tile gloss motion-rise motion-lift flex flex-col gap-3 rounded-xl border p-4 ${TONES[i % TONES.length]}`} style={{ ["--i" as string]: i }} data-testid="offer-card">
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--tone),color-mix(in_oklch,var(--tone)_55%,white))] text-white shadow-md"><Icon className="size-5" aria-hidden /></span>
                  <div className="min-w-0">
                    <div className="text-xl font-bold leading-tight text-[color:color-mix(in_oklch,var(--tone)_75%,var(--foreground))]">{headline(o)}</div>
                    <div className="font-medium">{L(o.name)}</div>
                    <div className="text-xs text-muted-foreground">{o.supplier ? t("from", { supplier: o.supplier.name }) : t("byFiringi")}</div>
                  </div>
                </div>
                {o.description && <p className="text-sm">{L(o.description)}</p>}
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {o.target?.productName && <li className="rounded-full border bg-card px-2 py-0.5">{L(o.target.productName)}</li>}
                  {o.minOrderValue && Number(o.minOrderValue) > 0 && <li className="rounded-full border bg-card px-2 py-0.5">{t("minOrder", { amount: formatMoney(o.minOrderValue, locale) })}</li>}
                  {o.minQty && <li className="rounded-full border bg-card px-2 py-0.5">{t("minQty", { qty: o.minQty })}</li>}
                  {o.firstOrderOnly && <li className="rounded-full border bg-card px-2 py-0.5">{t("firstOrder")}</li>}
                  {o.usesLeft !== null && <li className="rounded-full border bg-card px-2 py-0.5">{t("usesLeft", { count: o.usesLeft })}</li>}
                  {o.validTo && <li className="rounded-full border bg-card px-2 py-0.5">{t("validUntil", { date: formatDate(o.validTo, locale) })}</li>}
                </ul>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  {o.code ? (
                    <>
                      <span className="rounded-md border-2 border-dashed border-[color:var(--tone)] px-2 py-1 font-mono text-sm font-bold tracking-widest" data-testid="offer-code">{o.code}</span>
                      <UseCoupon code={o.code} label={t("use")} done={t("used")} />
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">{t("automatic")}</span>
                      <Link href={shopHref(o)} className="text-sm font-medium text-primary hover:underline">{t("shop")} →</Link>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
