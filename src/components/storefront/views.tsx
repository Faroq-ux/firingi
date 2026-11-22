/** Storefronts (Phase 61) — delivery terms and current offers, shared by the public page and the shop. */
import { BadgePercent, Clock, Gift, Tag, Truck } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { fill } from "./labels";

export type L = Record<string, string>;
type Delivery = { minOrder: number | null; minUnits: number | null; freeFrom: number | null; freeFromUnits: number | null; feeBelow: number | null; firingiFreeFrom: number | null };
type Offers = {
  promotions: { id: string; kind: string; value: number; name: string; description: string; minQty: number | null; minOrderValue: number | null; buyQty: number | null; freeQty: number | null; firstOrderOnly: boolean; validTo: string | null; products: string[]; wholeRange: boolean }[];
  deals: { id: string; kind: string; title: string | null; product: string; endsAt: string; bestBefore: string | null }[];
};

export function DeliveryTerms({ l, locale, d, accent }: { l: L; locale: string; d: Delivery; accent?: string }) {
  const m = (n: number) => formatMoney(n, locale);
  const rows: { key: string; text: string; strong?: boolean }[] = [];
  if (d.freeFrom != null) rows.push({ key: "free", text: fill(l.freeFrom, { amount: m(d.freeFrom) }), strong: true });
  else if (d.freeFromUnits != null) rows.push({ key: "free", text: fill(l.freeFromUnits, { units: d.freeFromUnits }), strong: true });
  if (d.firingiFreeFrom != null && (d.freeFrom == null || d.firingiFreeFrom < d.freeFrom)) rows.push({ key: "ffree", text: fill(l.firingiFree, { amount: m(d.firingiFreeFrom) }), strong: true });
  if (d.minOrder != null && d.minOrder > 0) rows.push({ key: "min", text: fill(l.minOrder, { amount: m(d.minOrder) }) });
  else if (d.minUnits != null && d.minUnits > 0) rows.push({ key: "min", text: fill(l.minOrderUnits, { units: d.minUnits }) });
  else rows.push({ key: "min", text: l.noMinimum });
  if (d.feeBelow != null && d.feeBelow > 0 && (d.freeFrom != null || d.freeFromUnits != null)) rows.push({ key: "fee", text: fill(l.feeBelow, { amount: m(d.feeBelow) }) });
  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="sf-delivery">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><Truck className="size-5" style={accent ? { color: accent } : undefined} /> {l.deliveryTitle}</h2>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => <li key={r.key} data-testid={`sf-delivery-${r.key}`} className={r.strong ? "font-medium" : "text-muted-foreground"}>{r.text}</li>)}
      </ul>
    </section>
  );
}

function offerHeadline(l: L, locale: string, p: Offers["promotions"][number]) {
  const m = (n: number) => formatMoney(n, locale);
  switch (p.kind) {
    case "PERCENT": return fill(l["offer.PERCENT"], { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(p.value) });
    case "FIXED_AMOUNT": return fill(l["offer.FIXED_AMOUNT"], { amount: m(p.value) });
    case "ORDER_AMOUNT": return fill(l["offer.ORDER_AMOUNT"], { amount: m(p.value) });
    case "BUY_X_GET_Y": return fill(l["offer.BUY_X_GET_Y"], { buy: p.buyQty ?? 0, free: p.freeQty ?? 0 });
    default: return l["offer.FREE_DELIVERY"];
  }
}

export function StoreOffers({ l, locale, o, accent }: { l: L; locale: string; o: Offers; accent?: string }) {
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const m = (n: number) => formatMoney(n, locale);
  const empty = !o.promotions.length && !o.deals.length;
  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="sf-offers">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><BadgePercent className="size-5" style={accent ? { color: accent } : undefined} /> {l.offersTitle}</h2>
      {empty ? <p className="text-sm text-muted-foreground">{l.noOffers}</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {o.promotions.map((p) => (
            <li key={p.id} className="min-w-0 rounded-xl border p-3" data-testid="sf-offer" style={accent ? { borderColor: `${accent}55` } : undefined}>
              <p className="flex items-center gap-2 font-semibold" style={accent ? { color: accent } : undefined}>{p.kind === "BUY_X_GET_Y" ? <Gift className="size-4 shrink-0" /> : p.kind === "FREE_DELIVERY" ? <Truck className="size-4 shrink-0" /> : <Tag className="size-4 shrink-0" />} {offerHeadline(l, locale, p)}</p>
              {p.name && <p className="mt-0.5 break-words text-sm">{p.name}</p>}
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {[p.products.length ? p.products.join(", ") : p.wholeRange ? l.offerWholeRange : null,
                  p.minQty ? fill(l.offerMinQty, { qty: p.minQty }) : null,
                  p.minOrderValue ? fill(l.offerMinOrder, { amount: m(p.minOrderValue) }) : null,
                  p.firstOrderOnly ? l.offerFirstOrder : null,
                  p.validTo ? fill(l.offerUntil, { date: date.format(new Date(p.validTo)) }) : null].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
          {o.deals.map((d) => (
            <li key={d.id} className="min-w-0 rounded-xl border border-dashed p-3" data-testid="sf-deal">
              <p className="flex items-center gap-2 font-semibold"><Clock className="size-4 shrink-0" /> {l[`deal.${d.kind}`] ?? d.kind}</p>
              <p className="mt-0.5 break-words text-sm">{d.title || d.product}</p>
              <p className="mt-1 text-xs text-muted-foreground">{[d.title ? d.product : null, fill(l.dealEnds, { date: date.format(new Date(d.endsAt)) }), d.bestBefore ? fill(l.bestBefore, { date: date.format(new Date(d.bestBefore)) }) : null].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** On the supplier's page in the shop: its storefront branding (when published), delivery terms and offers. */
export async function ShopStorePanel({ vendorId, locale }: { vendorId: string; locale: string }) {
  const { shopBranding } = await import("@/server/storefront/service");
  const { sfLabels } = await import("./labels");
  const b = await shopBranding(vendorId, locale);
  if (!b) return null;
  const { l } = await sfLabels();
  return (
    <div className="mb-6 space-y-4" data-testid="shop-store-panel">
      {b.published && (b.hasBanner || b.tagline || b.about) && (
        <div className="overflow-hidden rounded-2xl border bg-card">
          {b.hasBanner && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/storefront/${b.slug}/banner`} alt="" className="h-32 w-full object-cover sm:h-40" />}
          <div className="flex flex-wrap items-start gap-3 p-4">
            {b.hasLogo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/storefront/${b.slug}/logo`} alt="" className="size-14 shrink-0 rounded-xl border bg-background object-contain" />}
            <div className="min-w-0 flex-1 basis-60">
              {b.tagline && <p className="break-words font-medium" style={{ color: b.accent }} data-testid="shop-store-tagline">{b.tagline}</p>}
              {b.about && <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm text-muted-foreground">{b.about}</p>}
            </div>
            <a href={`/s/${b.slug}`} target="_blank" className="text-sm font-medium hover:underline" style={{ color: b.accent }}>{l.storeLink} ↗</a>
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <DeliveryTerms l={l} locale={locale} d={b.delivery} accent={b.accent} />
        <StoreOffers l={l} locale={locale} o={b.offers} accent={b.accent} />
      </div>
    </div>
  );
}

/** In the shop's supplier list: the wholesaler the customer joined from. */
export async function HomeStoreCard({ ctx }: { ctx: import("@/server/context").Ctx }) {
  const { myHomeStore } = await import("@/server/storefront/service");
  const h = await myHomeStore(ctx);
  if (!h) return null;
  const { sfLabels } = await import("./labels");
  const { l } = await sfLabels();
  return (
    <a href={`/buy/catalogue/suppliers/${h.companyId}`} className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border p-4 transition-colors hover:bg-accent" style={{ borderColor: `${h.accent}66` }} data-testid="home-store">
      {h.hasLogo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/storefront/${h.slug}/logo`} alt="" className="size-12 rounded-xl border bg-background object-contain" />}
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: h.accent }}>{l.homeStore}</p>
        <p className="break-words font-semibold">{h.name}</p>
        <p className="break-words text-xs text-muted-foreground">{h.tagline ?? fill(l.homeStoreHint, { name: h.name })}</p>
      </div>
      <span className="rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ background: h.accent }}>{l.visitStore} →</span>
    </a>
  );
}
