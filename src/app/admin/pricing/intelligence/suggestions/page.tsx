import Link from "next/link";
import { Sparkles } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { canManagePricing } from "@/server/price-intel/service";
import { priceSuggestions } from "@/server/price-intel/insights";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyCommission, AskSupplier } from "@/components/price-intel/admin";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Price Suggestions" };

export default async function PriceSuggestions() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const d = await priceSuggestions(ctx);
  const canCommission = can(ctx, "admin.vendors.commission");
  const manage = canManagePricing(ctx);
  return (
    <>
      <PageHeader title="Price Suggestions" icon={Sparkles} description="Suggestions from FIRINGI's price engine, each with its reason. Nothing changes until someone decides: commission changes go through the usual commission rules (incl. a second approval when that's switched on); price reviews are a message to the supplier." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Commission</CardTitle><CardDescription>Suppliers whose margin over the last 90 days is under the <Link href="/admin/pricing/margin" className="text-primary hover:underline">margin rule</Link>.</CardDescription></CardHeader>
          <CardContent>
            {d.commission.length === 0 ? <p className="text-sm text-muted-foreground">Every supplier meets its margin rule (or no rule applies).</p> : (
              <ul className="space-y-3" data-testid="commission-suggestions">
                {d.commission.map((c) => (
                  <li key={c.vendorId} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.vendor}</span><Badge variant={c.below === "MIN" ? "destructive" : "warning"}>{c.below === "MIN" ? "below minimum" : "below target"}</Badge><span className="ml-auto text-sm tabular-nums">{c.currentRate ?? "—"} % → <b>{c.suggested} %</b></span></div>
                    <p className="mt-1 text-sm text-muted-foreground">{c.why} At {c.suggested} % FIRINGI would have earned about {formatMoney(c.extra, "en")} more.</p>
                    {canCommission && <div className="mt-2"><ApplyCommission vendorId={c.vendorId} rate={c.suggested} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Price reviews</CardTitle><CardDescription>Offers far from the median of the same product.</CardDescription></CardHeader>
          <CardContent>
            {d.reviews.length === 0 ? <p className="text-sm text-muted-foreground">Every compared price is close to its market.</p> : (
              <ul className="space-y-3" data-testid="review-suggestions">
                {d.reviews.slice(0, 40).map((r) => (
                  <li key={r.offerId} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/pricing/intelligence/history?variant=${r.variantId}`} className="font-semibold text-primary hover:underline">{r.product}</Link>
                      <span className="text-sm text-muted-foreground">{r.vendor}</span>
                      <Badge variant={r.kind === "ABOVE" ? "destructive" : "default"} className="ml-auto">{r.dev > 0 ? "+" : ""}{r.dev.toFixed(0)} %</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{formatMoney(r.price, "en")} vs median {formatMoney(r.median, "en")}. {r.why}</p>
                    {manage && <div className="mt-2"><AskSupplier offerId={r.offerId} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
