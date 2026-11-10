/** Back office list of coupons or customer offers: what they give, to whom, limits, use and cost. */
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { listOffers, marketingOptions } from "@/server/marketing/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PromotionStatusButtons } from "@/components/finance/controls";
import { OfferForm } from "./offer-form";
import { formatDate, formatMoney } from "@/lib/utils";

const en = (v: unknown) => (v as { en?: string } | null)?.en ?? "";
export function describeOffer(p: { kind: string; value: { toString(): string }; buyQty: number | null; freeQty: number | null; minOrderValue: { toString(): string } | null; minQty: number | null }) {
  const v = Number(p.value.toString());
  const what = p.kind === "PERCENT" ? `${v} % off` : p.kind === "FIXED_AMOUNT" ? `${formatMoney(v, "en")} off per unit` : p.kind === "ORDER_AMOUNT" ? `${formatMoney(v, "en")} off the order`
    : p.kind === "BUY_X_GET_Y" ? `Buy ${p.buyQty}, get ${p.freeQty} free` : "Free delivery";
  const cond = [p.minOrderValue && Number(p.minOrderValue.toString()) > 0 ? `orders ≥ ${formatMoney(p.minOrderValue.toString(), "en")}` : null, p.minQty ? `≥ ${p.minQty} units` : null].filter(Boolean).join(", ");
  return cond ? `${what} (${cond})` : what;
}

export async function OffersView({ ctx, kind }: { ctx: Ctx; kind: "COUPONS" | "OFFERS" }) {
  const manage = can(ctx, ["admin.marketing.manage", "admin.pricing.manage"]);
  const [rows, opts] = await Promise.all([listOffers(ctx, kind), marketingOptions(ctx)]);
  const coupons = kind === "COUPONS";
  return (
    <>
      <PageHeader
        title={coupons ? "Coupons" : "Customer Offers"}
        description={coupons
          ? "Codes customers enter in their cart (or use from “My offers” / a campaign). One coupon per order, on top of automatic offers. FIRINGI-paid coupons work everywhere; supplier-paid ones only on that supplier's orders. Limits count orders that aren't cancelled."
          : "Automatic offers aimed at customers: one company, a CRM segment, a customer group, first orders — and € off the order, free delivery or buy X get Y. They apply in the cart without a code and are listed in the customer's “My offers”."}
      />
      {manage && <div className="mb-4"><OfferForm mode="ADMIN" variant={coupons ? "coupon" : "offer"} categories={opts.categories} groups={opts.groups} vendors={opts.vendors} buyers={opts.buyers} segments={opts.segments} /></div>}
      <Card>
        <CardContent className="pt-5">
          <Table data-testid={coupons ? "coupons-table" : "offers-table"}>
            <THead><TR>{coupons && <TH>Code</TH>}<TH>Offer</TH><TH>For</TH><TH>By · paid by</TH><TH>Valid</TH><TH className="text-right">Uses</TH><TH className="text-right">Given</TH><TH>Status</TH>{manage && <TH />}</TR></THead>
            <TBody>
              {rows.map((r) => {
                const who = r.targets.filter((t) => t.buyer || t.segment || t.customerGroup).map((t) => t.buyer?.legalName ?? (t.segment ? `Segment: ${t.segment.name}` : `Group: ${t.customerGroup!.name}`));
                const what = r.targets.filter((t) => t.category || t.vendor).map((t) => (t.category ? en(t.category.name) : t.vendor!.legalName));
                const fp = Number(r.firingiFundPct);
                return (
                  <TR key={r.id}>
                    {coupons && <TD className="font-mono font-semibold tracking-wide">{r.code}</TD>}
                    <TD><div className="font-medium">{en(r.name)}</div><div className="text-xs text-muted-foreground">{describeOffer(r)}{what.length ? ` · ${what.join(", ")}` : ""}</div></TD>
                    <TD className="text-xs">{[...who, r.firstOrderOnly ? "first order" : null].filter(Boolean).join(" · ") || "everyone"}</TD>
                    <TD className="text-xs">{r.ownerType === "ADMIN" ? "FIRINGI" : (r.owner?.tradeName ?? r.owner?.legalName)} · {r.ownerType === "VENDOR" ? "supplier" : fp === 100 ? "FIRINGI" : fp === 0 ? "supplier" : `${fp}/${100 - fp}`}
                      {r.acceptances.some((a) => a.status === "PENDING") && <div className="text-warning">awaiting {r.acceptances.filter((a) => a.status === "PENDING").length} supplier(s)</div>}</TD>
                    <TD className="text-xs">{formatDate(r.validFrom, "en-GB")} – {r.validTo ? formatDate(r.validTo, "en-GB") : "open"}</TD>
                    <TD className="text-right tabular-nums">{r.uses}{r.maxRedemptions ? ` / ${r.maxRedemptions}` : ""}{r.maxPerCustomer ? <div className="text-xs text-muted-foreground">{r.maxPerCustomer}× per customer</div> : null}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.given, "en")}{r.budget ? <div className="text-xs text-muted-foreground">of {formatMoney(r.budget.toString(), "en")}</div> : null}{r.vendorPaid > 0 && <div className="text-xs text-muted-foreground">supplier {formatMoney(r.vendorPaid, "en")}</div>}</TD>
                    <TD><Badge variant={r.status === "ACTIVE" ? "success" : r.status === "PAUSED" ? "warning" : "secondary"}>{r.status.toLowerCase()}</Badge></TD>
                    {manage && <TD>{r.ownerType === "ADMIN" && <PromotionStatusButtons id={r.id} status={r.status} />}</TD>}
                  </TR>
                );
              })}
              {!rows.length && <EmptyRow colSpan={9}>{coupons ? "No coupons yet." : "No customer offers yet."}</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
