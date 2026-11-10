"use client";
/**
 * Offer / coupon form — FIRINGI (coupons, customer offers; English) and suppliers (their own
 * promotions and coupons; translated labels passed in `l`).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { saveOfferAction, saveVendorOfferAction } from "@/server/actions/marketing";

type Opt = { id: string; label: string };
export const OFFER_KINDS = ["PERCENT", "FIXED_AMOUNT", "ORDER_AMOUNT", "FREE_DELIVERY", "BUY_X_GET_Y"] as const;
export type OfferLabels = Record<
  "newOffer" | "newCoupon" | "name" | "description" | "type" | "value" | "buy" | "free" | "code" | "codeHint" | "validFrom" | "validTo" | "minQty" | "minOrder" |
  "maxRedemptions" | "maxPerCustomer" | "firstOrder" | "showInOffers" | "products" | "categories" | "groups" | "save" | "note" | `kind_${(typeof OFFER_KINDS)[number]}`,
  string
>;

export const EN_OFFER_LABELS: OfferLabels = {
  newOffer: "New customer offer", newCoupon: "New coupon", name: "Name (shown to customers)", description: "Description (optional)", type: "Type", value: "Discount",
  buy: "Buy", free: "Get free", code: "Coupon code", codeHint: "Letters and digits, e.g. WELCOME10. Leave empty for an automatic offer.",
  validFrom: "From", validTo: "Until (optional)", minQty: "Min. quantity per product", minOrder: "Minimum order € (excl. VAT)",
  maxRedemptions: "Uses in total", maxPerCustomer: "Uses per customer", firstOrder: "First order only", showInOffers: "Show in customers' “My offers”",
  products: "Products", categories: "Categories", groups: "Customer groups", save: "Save", note: "",
  kind_PERCENT: "% off products", kind_FIXED_AMOUNT: "€ off per unit", kind_ORDER_AMOUNT: "€ off the order", kind_FREE_DELIVERY: "Free delivery", kind_BUY_X_GET_Y: "Buy X, get Y free",
};

export function OfferForm({ mode, variant, l = EN_OFFER_LABELS, offers = [], categories = [], groups = [], vendors = [], buyers = [], segments = [] }: {
  mode: "ADMIN" | "VENDOR"; variant: "coupon" | "offer" | "any"; l?: OfferLabels;
  offers?: Opt[]; categories?: Opt[]; groups?: Opt[]; vendors?: Opt[]; buyers?: Opt[]; segments?: Opt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof OFFER_KINDS)[number]>(variant === "offer" ? "ORDER_AMOUNT" : "PERCENT");
  const [fund, setFund] = useState(100);
  if (!open) return <Button onClick={() => setOpen(true)} data-testid="new-offer">{variant === "coupon" ? l.newCoupon : l.newOffer}</Button>;
  const multi = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);
  const n = (fd: FormData, k: string) => (fd.get(k) ? Number(fd.get(k)) : null);
  const box = (name: string, label: string, opts: Opt[]) => opts.length > 0 && (
    <div className="space-y-1"><Label>{label}</Label><select name={name} multiple className="h-28 w-full rounded-md border bg-card p-1 text-sm">{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
  );
  return (
    <form className="space-y-3 rounded-xl border bg-card p-4" data-testid="offer-form" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = {
        name: { en: String(fd.get("name")), pt: String(fd.get("namePt") || "") || null },
        description: fd.get("description") ? { en: String(fd.get("description")) } : null,
        kind, value: kind === "FREE_DELIVERY" ? 100 : kind === "BUY_X_GET_Y" ? Number(fd.get("freeQty") || 1) : Number(fd.get("value")),
        buyQty: n(fd, "buyQty"), freeQty: n(fd, "freeQty"), validFrom: String(fd.get("validFrom")), validTo: String(fd.get("validTo") || "") || null,
        minQty: n(fd, "minQty"), minOrderValue: n(fd, "minOrderValue"), maxRedemptions: n(fd, "maxRedemptions"), maxPerCustomer: n(fd, "maxPerCustomer"), budget: n(fd, "budget"),
        code: variant === "offer" ? null : String(fd.get("code") || "") || null, firstOrderOnly: fd.get("firstOrderOnly") === "on", showInOffers: fd.get("showInOffers") === "on",
        targets: { offerIds: multi(fd, "offers"), categoryIds: multi(fd, "categories"), customerGroupIds: multi(fd, "groups"), vendorIds: multi(fd, "vendors"), buyerCompanyIds: multi(fd, "buyers"), segmentIds: multi(fd, "segments") },
        ...(mode === "ADMIN" ? { firingiFundPct: fund } : {}),
      };
      start(async () => {
        const r = await (mode === "ADMIN" ? saveOfferAction(payload) : saveVendorOfferAction(payload));
        if (r.ok) { setError(null); setOpen(false); router.refresh(); } else setError(r.error);
      });
    }}>
      {l.note && <p className="text-sm text-muted-foreground">{l.note}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2"><Label>{l.name}</Label><Input name="name" required minLength={2} /></div>
        {mode === "ADMIN" && <div className="space-y-1 sm:col-span-2"><Label>Name in Portuguese (optional)</Label><Input name="namePt" /></div>}
        <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label>{l.description}</Label><Input name="description" maxLength={300} /></div>
        <div className="space-y-1"><Label>{l.type}</Label>
          <Select name="kind" value={kind} onChange={(e) => { const k = e.target.value as typeof kind; setKind(k); if (k === "FREE_DELIVERY" && fund !== 0 && fund !== 100) setFund(100); }}>
            {OFFER_KINDS.map((k) => <option key={k} value={k}>{l[`kind_${k}`]}</option>)}
          </Select>
        </div>
        {kind === "BUY_X_GET_Y" ? (
          <div className="flex gap-2"><div className="space-y-1"><Label>{l.buy}</Label><Input name="buyQty" type="number" min={1} required className="w-20" /></div><div className="space-y-1"><Label>{l.free}</Label><Input name="freeQty" type="number" min={1} required className="w-20" /></div></div>
        ) : kind !== "FREE_DELIVERY" ? (
          <div className="space-y-1"><Label>{l.value} {kind === "PERCENT" ? "(%)" : "(€)"}</Label><Input name="value" type="number" min="0.01" step="0.01" required /></div>
        ) : <span />}
        {variant !== "offer" && <div className="space-y-1 sm:col-span-2"><Label>{l.code}</Label><Input name="code" className="font-mono uppercase" required={variant === "coupon"} pattern="[A-Za-z0-9_\-]{3,32}" /><p className="text-xs text-muted-foreground">{l.codeHint}</p></div>}
        <div className="space-y-1"><Label>{l.validFrom}</Label><Input name="validFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div className="space-y-1"><Label>{l.validTo}</Label><Input name="validTo" type="date" /></div>
        <div className="space-y-1"><Label>{l.minOrder}</Label><Input name="minOrderValue" type="number" min={0} step="0.01" /></div>
        {kind !== "ORDER_AMOUNT" && kind !== "FREE_DELIVERY" && <div className="space-y-1"><Label>{l.minQty}</Label><Input name="minQty" type="number" min={1} /></div>}
        <div className="space-y-1"><Label>{l.maxRedemptions}</Label><Input name="maxRedemptions" type="number" min={1} /></div>
        <div className="space-y-1"><Label>{l.maxPerCustomer}</Label><Input name="maxPerCustomer" type="number" min={1} /></div>
        {mode === "ADMIN" && <div className="space-y-1"><Label>Budget € (stops when reached)</Label><Input name="budget" type="number" min={1} step="0.01" /></div>}
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="firstOrderOnly" /> {l.firstOrder}</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="showInOffers" defaultChecked /> {l.showInOffers}</label>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {box("offers", l.products, offers)}
        {box("categories", l.categories, categories)}
        {mode === "ADMIN" && box("vendors", "Suppliers (their products)", vendors)}
        {box("groups", l.groups, groups)}
        {mode === "ADMIN" && box("buyers", "Only these companies", buyers)}
        {mode === "ADMIN" && box("segments", "Only these CRM segments", segments)}
      </div>
      {mode === "ADMIN" && (
        kind === "FREE_DELIVERY" ? (
          <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1 text-sm font-medium">Who pays the delivery?</legend>
            <label className="flex items-center gap-2"><input type="radio" name="fund" checked={fund === 100} onChange={() => setFund(100)} /> FIRINGI (waives its fee / pays the supplier’s flat rate)</label>
            <label className="flex items-center gap-2"><input type="radio" name="fund" checked={fund === 0} onChange={() => setFund(0)} /> The supplier (delivers free; must accept)</label>
          </fieldset>
        ) : (
          <div className="space-y-1">
            <Label>Who pays the discount? FIRINGI {fund}% · supplier {100 - fund}%</Label>
            <input type="range" min={0} max={100} step={5} value={fund} onChange={(e) => setFund(Number(e.target.value))} className="w-72 accent-[var(--primary)]" aria-label="FIRINGI share" />
            {fund < 100 && <p className="text-xs text-muted-foreground">Choose the suppliers above; each must accept its share before the offer applies to its products. Carts FIRINGI routes to suppliers only take FIRINGI-paid offers.</p>}
          </div>
        )
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{l.save}</Button><Button type="button" variant="outline" onClick={() => setOpen(false)}>✕</Button></div>
    </form>
  );
}
