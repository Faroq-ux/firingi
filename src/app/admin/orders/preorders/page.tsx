import Link from "next/link";
import { CalendarClock, ClipboardCheck, Lock, Package, Users } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/preorders/campaigns";
import { preOverrideList, preSettings } from "@/server/preorders/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { TabLinks } from "@/app/admin/ai/_kit";
import { AdminCancelLock, CompanyPreSwitch, FindPreBusiness, PreSettingsForm, ReviewLock, RunJob } from "@/components/preorders/admin";

export const metadata = { title: "Pre-orders & Price Locks" };
export const dynamic = "force-dynamic";
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);
const day = (d: Date) => d.toISOString().slice(0, 10);
const STATUS: Record<string, string> = { DRAFT: "Draft", PENDING: "To review", OPEN: "Open", CLOSED: "Closed", ALLOCATED: "Shared out", DONE: "Finished", CANCELLED: "Cancelled", REJECTED: "Rejected", REQUESTED: "Waiting for supplier", REVIEW: "To approve", ACTIVE: "Active", EXPIRED: "Ended" };
const KIND: Record<string, string> = { SEASONAL: "Seasonal", LAUNCH: "New product", SCARCE: "Short supply" };

/** Phase 71: FIRINGI's view of pre-orders & price locks (English) — review, everything running, switches. */
export default async function AdminPreorders({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.pricing.view", "admin.pricing.manage", "admin.settings.manage"]);
  const q = (await searchParams).tab;
  const tab = ["CAMPAIGNS", "LOCKS", "SETTINGS"].includes(q ?? "") ? q! : "CAMPAIGNS";
  const manage = can(ctx, ["admin.orders.manage", "admin.pricing.manage", "admin.settings.manage"]);
  const [o, s, overrides] = await Promise.all([adminOverview(ctx), preSettings(), preOverrideList(ctx)]);
  const { companies: _c, ...form } = s;
  void _c;
  const pending = o.campaigns.filter((c) => c.status === "PENDING"), lockReview = o.locks.filter((l) => l.status === "REVIEW");
  return (
    <>
      <PageHeader title="Pre-orders & Price Locks" icon={CalendarClock} actions={manage ? <RunJob /> : undefined}
        description={`Distributors and wholesalers open pre-orders (seasonal, new products, short supply) and lock prices for their buyers. ${s.approval === "ALWAYS" ? "FIRINGI approves every pre-order." : "Pre-orders open without review."} FIRINGI invoices the buyer as usual; commission stays hidden from buyers.`} />
      <TabLinks testid="ap-tabs" active={tab} href={(k) => `/admin/orders/preorders?tab=${k}`} tabs={[{ key: "CAMPAIGNS", label: "Pre-orders", count: pending.length || undefined }, { key: "LOCKS", label: "Price locks", count: lockReview.length || undefined }, { key: "SETTINGS", label: "Settings" }]} />
      {tab === "CAMPAIGNS" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile icon={ClipboardCheck} label="To review" value={o.counts.PENDING ?? 0} locale="en" tone="tone-orange" testId="ap-pending" />
            <Tile icon={CalendarClock} label="Open now" value={o.counts.OPEN ?? 0} locale="en" tone="tone-teal" i={1} />
            <Tile icon={Users} label="Buyers' pre-orders (active)" value={(o.reservations.PLACED ?? 0) + (o.reservations.ALLOCATED ?? 0) + (o.reservations.CONFIRMED ?? 0)} locale="en" tone="tone-blue" i={2} />
            <Tile icon={Package} label="Turned into orders" value={o.reservations.ORDERED ?? 0} locale="en" tone="tone-violet" i={3} />
          </div>
          <Card>
            <CardHeader><CardTitle>All pre-orders</CardTitle></CardHeader>
            <CardContent>{!o.campaigns.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="divide-y" data-testid="ap-list">{o.campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="ap-row" data-status={c.status}>
                  <Link className="min-w-0 flex-1 basis-60 break-words font-medium text-primary hover:underline" href={`/admin/orders/preorders/${c.id}`}>{c.title} <span className="text-xs font-normal text-muted-foreground">{c.number}</span></Link>
                  <span className="text-xs text-muted-foreground">{c.vendor} ({c.sellerType.toLowerCase()}) · {KIND[c.kind]} · closes {day(c.closesAt)} · {c.buyers} buyers · {eur(c.value)}</span>
                  <Badge variant={c.status === "PENDING" ? "warning" : c.status === "OPEN" ? "success" : "secondary"}>{STATUS[c.status]}</Badge>
                </li>
              ))}</ul>
            )}</CardContent>
          </Card>
        </div>
      )}
      {tab === "LOCKS" && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="size-4" /> Price locks</CardTitle><CardDescription>{s.lockReviewAbove > 0 ? `Locks worth more than ${eur(s.lockReviewAbove)} wait for FIRINGI after the supplier accepts.` : "Locks start as soon as the supplier accepts."}</CardDescription></CardHeader>
          <CardContent>{!o.locks.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <ul className="divide-y">{o.locks.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="al-row" data-status={x.status}>
                <span className="min-w-0 flex-1 basis-60 break-words"><b>{x.number}</b> · {x.buyer} ← {x.vendor} · {x.qtyTaken}/{x.qtyTotal} × {eur(x.unitNet)} = {eur(x.value)}{x.validUntil ? ` · until ${day(x.validUntil)}` : ""}</span>
                <Badge variant={x.status === "REVIEW" ? "warning" : x.status === "ACTIVE" ? "success" : "secondary"}>{STATUS[x.status] ?? x.status}</Badge>
                {manage && x.status === "REVIEW" && <ReviewLock id={x.id} />}
                {manage && ["REQUESTED", "REVIEW", "ACTIVE"].includes(x.status) && <AdminCancelLock id={x.id} />}
              </li>
            ))}</ul>
          )}</CardContent>
        </Card>
      )}
      {tab === "SETTINGS" && (
        <div className="space-y-6">
          <Card><CardContent className="pt-6">{manage ? <PreSettingsForm initial={form} /> : <p className="text-sm text-muted-foreground">Your role can&apos;t change these.</p>}</CardContent></Card>
          <Card>
            <CardHeader><CardTitle>Single companies</CardTitle><CardDescription>Switch pre-orders & price locks on or off for one seller or buyer, whatever the settings above say.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {!overrides.length ? <p className="text-sm text-muted-foreground">None — every company follows the settings.</p> : (
                <ul className="divide-y" data-testid="aps-overrides">{overrides.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words font-medium">{c.name} <span className="text-xs font-normal text-muted-foreground">· {c.type.toLowerCase()}</span></span>{manage ? <CompanyPreSwitch companyId={c.id} state={c.state} /> : <span>{c.state === "ON" ? "Always on" : "Off"}</span>}</li>)}</ul>
              )}
              {manage && <FindPreBusiness />}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
