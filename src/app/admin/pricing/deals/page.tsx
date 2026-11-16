import Link from "next/link";
import { Flame } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminDeals, dealsOverview } from "@/server/deals/service";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewDeal, StopDeal, TrustedSwitch } from "@/components/deals/admin";
import { termsText } from "@/components/deals/labels";
import en from "@/messages/en.json";

export const metadata = { title: "Clearance Deals" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { FLASH: "Flash price", BUNDLE: "Multi-buy", VOLUME: "Volume tiers", LOT: "Whole lot", BEST_OFFER: "Best offer" };
const flat = (o: Record<string, unknown>, p = ""): Record<string, string> => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage", "admin.vendors.view"]);
  const status = (await searchParams).status ?? "PENDING";
  const [o, deals] = await Promise.all([dealsOverview(ctx), adminDeals(ctx, { status })]);
  const manage = ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"].some((p) => ctx.permissions.has(p as never));
  const l = flat(en.deals);
  const eur = (n: unknown) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(n));
  const when = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(d);
  return (
    <>
      <PageHeader title="Clearance Deals" icon={Flame} description="Suppliers' time-limited deals on short-dated or surplus stock. Approve or turn down deals waiting for FIRINGI, set the commission on a deal, stop a deal, mark trusted suppliers." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="deal-kpis">
        {[["Waiting for FIRINGI", String(o.pending)], ["Live now", String(o.live)], ["Sold on deals (30 days)", eur(o.revenue30)], ["Commission on deals (30 days)", eur(o.commission30)]].map(([k, v]) => <Card key={k}><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{k}</p><p className="text-2xl font-semibold tabular-nums">{v}</p></CardContent></Card>)}
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[["PENDING", "Waiting"], ["LIVE", "Live"], ["ENDED", "Ended"], ["ALL", "All"]].map(([k, label]) => <Link key={k} href={`?status=${k}`} className={`rounded-md border px-3 py-1 ${status === k ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</Link>)}
        <Link href="/admin/pricing/deals/settings" className="ml-auto rounded-md border px-3 py-1 hover:bg-accent">Settings</Link>
      </div>
      <Card><CardContent className="pt-4">
        {!deals.length ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="deals-empty">Nothing here.</p> : (
          <ul className="divide-y" data-testid="admin-deals">
            {deals.map((d) => (
              <li key={d.id} className="space-y-1.5 py-3 text-sm" data-testid="admin-deal" data-status={d.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{d.number}</span>
                  <span className="font-medium">{d.vendor.tradeName ?? d.vendor.legalName}</span>
                  <span>{pickLocalized(d.offer.packaging.variant.product.name, "en")}</span>
                  <Badge variant="secondary">{KIND[d.kind]}</Badge>
                  <Badge variant={d.status === "APPROVED" ? "success" : d.status === "PENDING" ? "warning" : "outline"}>{d.status.toLowerCase().replace("_", " ")}</Badge>
                  {d.clearance && <Badge variant="warning">clearance ({d.clearanceReason === "EXPIRY" ? `best before ${d.bestBefore?.toISOString().slice(0, 10)}` : "overstock"})</Badge>}
                  {d.autoApproved && <span className="text-xs text-muted-foreground">approved by itself</span>}
                  {manage && <span className="ml-auto"><TrustedSwitch companyId={d.vendorCompanyId} on={d.trusted} /></span>}
                </div>
                <p>{termsText(l, d, "en-GB", { supplier: true })} · list {eur(d.listPriceAt ?? 0)}{d.discountPct != null ? ` · −${Number(d.discountPct).toFixed(1)} %` : ""} · commission {d.commissionPct != null ? `${Number(d.commissionPct)} % (deal)` : "usual rate"} on the deal price</p>
                <p className="text-xs text-muted-foreground">{when(d.startsAt)} → {when(d.endsAt)} · sold {d.sold}{d.maxQty != null ? ` of ${d.maxQty}` : ""} · {eur(d.revenue)} · commission {eur(d.commission)}{d.reviewNote ? ` · note: ${d.reviewNote}` : ""}</p>
                {manage && d.status === "PENDING" && <ReviewDeal id={d.id} suggested={d.commissionPct == null ? null : Number(d.commissionPct)} />}
                {manage && d.status === "APPROVED" && <StopDeal id={d.id} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </>
  );
}
