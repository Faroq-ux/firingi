import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { campaignDetail } from "@/server/preorders/campaigns";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminCancelCampaign, ReviewCampaign } from "@/components/preorders/admin";

export const metadata = { title: "Pre-order" };
export const dynamic = "force-dynamic";
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);
const day = (d: Date) => d.toISOString().slice(0, 10);
const ALLOC: Record<string, string> = { PRO_RATA: "in proportion", FIRST_COME: "first come, first served", LOYAL_FIRST: "regular customers first" };

/** Phase 71: one pre-order for FIRINGI (English) — review, products and prices, buyers, cancel. */
export default async function AdminPreorder({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.pricing.view", "admin.pricing.manage", "admin.settings.manage"]);
  const d = await campaignDetail(ctx, (await params).id, "en").catch(() => null);
  if (!d) notFound();
  const c = d.campaign;
  const manage = can(ctx, ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"]);
  return (
    <>
      <PageHeader title={c.title} icon={CalendarClock} eyebrow={c.number} description={`${c.vendor} (${c.sellerType.toLowerCase()}) · ${c.kind.toLowerCase()} · opens ${day(c.opensAt)} · closes ${day(c.closesAt)} · delivery ${c.deliveryDates.map(day).join(", ")} · short supply shared ${ALLOC[c.allocation]}${c.depositPct ? ` · deposit ${c.depositPct}%` : ""}`}
        actions={<Link className="text-sm text-primary underline" href="/admin/orders/preorders">All pre-orders</Link>} />
      <div className="space-y-6">
        <p className="flex flex-wrap items-center gap-2 text-sm"><Badge data-testid="ad-status">{c.status}</Badge>{c.reviewNote && <span className="text-muted-foreground">Note: {c.reviewNote}</span>}{c.cancelReason && <span className="text-muted-foreground">Cancelled: {c.cancelReason}</span>}</p>
        {c.description && <p className="whitespace-pre-line text-sm">{c.description}</p>}
        {manage && c.status === "PENDING" && <Card><CardContent className="pt-6"><ReviewCampaign id={c.id} /></CardContent></Card>}
        <Card>
          <CardHeader><CardTitle>Products</CardTitle><CardDescription>Value pre-ordered: {eur(d.value)}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-medium">Product</th><th className="px-2 py-1 text-right font-medium">Pre-order price</th><th className="px-2 py-1 text-right font-medium">List price today</th><th className="px-2 py-1 font-medium">Tiers</th><th className="px-2 py-1 text-right font-medium">Min / max</th><th className="px-2 py-1 text-right font-medium">Supply</th><th className="py-1 pl-2 text-right font-medium">Pre-ordered</th></tr></thead>
            <tbody>{d.items.map((i) => (
              <tr key={i.id} className="border-t align-top" data-testid="ad-item">
                <td className="py-1 pr-2">{i.product} <span className="text-xs text-muted-foreground">{i.pack} · {i.sku}</span></td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(i.unitNet)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{i.listPrice == null ? "—" : eur(i.listPrice)}</td>
                <td className="px-2 py-1 text-xs">{i.tiers.length ? i.tiers.map((t) => `${t.minTotal}+ → ${eur(t.unitNet)}`).join(" · ") : "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{i.minQty} / {i.maxQty ?? "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{i.supplyQty ?? "no limit"}</td>
                <td className="py-1 pl-2 text-right tabular-nums">{i.total}</td>
              </tr>
            ))}</tbody>
          </table></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Buyers&apos; pre-orders</CardTitle></CardHeader>
          <CardContent>{!d.reservations.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <ul className="divide-y">{d.reservations.map((r) => (
              <li key={r.id} className="py-2 text-sm"><b>{r.buyer}</b> <span className="text-xs text-muted-foreground">{r.number}</span> · {r.status} · delivery {day(r.deliveryDate)} · {r.lines.map((x) => `${x.product}: ${x.allocatedQty ?? x.qty}${x.allocatedQty != null && x.allocatedQty !== x.qty ? `/${x.qty}` : ""}`).join(", ")}{r.deposit.amount ? ` · deposit ${eur(r.deposit.amount)}${r.deposit.paid ? " paid" : ""}` : ""}{r.failReason ? ` · ${r.failReason}` : ""}</li>
            ))}</ul>
          )}</CardContent>
        </Card>
        {manage && !["DONE", "CANCELLED", "REJECTED"].includes(c.status) && <Card><CardHeader><CardTitle>Cancel</CardTitle></CardHeader><CardContent><AdminCancelCampaign id={c.id} /></CardContent></Card>}
      </div>
    </>
  );
}
