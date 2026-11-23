import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Lock, Plus } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { preAccess } from "@/server/preorders/settings";
import { vendorCampaigns } from "@/server/preorders/campaigns";
import { vendorLocks } from "@/server/preorders/locks";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TabLinks } from "@/app/admin/ai/_kit";
import { preLabels } from "@/components/preorders/labels";
import { LockDecision } from "@/components/preorders/vendor";

export const metadata = { title: "Pre-orders & Price Locks" };
export const dynamic = "force-dynamic";
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const TONE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { DRAFT: "secondary", PENDING: "warning", OPEN: "success", CLOSED: "default", ALLOCATED: "default", DONE: "secondary", CANCELLED: "secondary", REJECTED: "destructive", REQUESTED: "warning", REVIEW: "warning", ACTIVE: "success", EXPIRED: "secondary" };

/** Phase 71: the supplier's pre-order campaigns and price-lock requests. */
export default async function VendorPreorders({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.pricing.manage", "vendor.orders.view", "vendor.orders.manage"]);
  const a = await preAccess(ctx.company);
  if (!a.sellerCampaigns && !a.sellerLocks) notFound();
  const { l, locale } = await preLabels();
  const q = (await searchParams).tab;
  const tabs = [...(a.sellerCampaigns ? [{ key: "CAMPAIGNS", label: l.tabCampaigns }] : []), ...(a.sellerLocks ? [{ key: "LOCKS", label: l.tabLocks }] : [])];
  const tab = tabs.some((t) => t.key === q) ? q! : tabs[0].key;
  const manage = can(ctx, ["vendor.promotions.manage", "vendor.pricing.manage"]);
  const eur = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const day = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);
  const camps = tab === "CAMPAIGNS" ? await vendorCampaigns(ctx) : null;
  const locks = tab === "LOCKS" ? await vendorLocks(ctx, locale) : null;
  return (
    <>
      <PageHeader title={l.sellerTitle} icon={CalendarClock} description={l.sellerIntro}
        actions={tab === "CAMPAIGNS" && manage ? <Link className={buttonVariants()} href="/vendor/orders/preorders/new" data-testid="vp-new"><Plus className="size-4" /> {l.sellerNewCampaign}</Link> : undefined} />
      <TabLinks testid="vp-tabs" active={tab} href={(k) => `/vendor/orders/preorders?tab=${k}`} tabs={tabs} />
      {camps && (!camps.campaigns.length ? <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{l.sellerNoCampaigns}</p></CardContent></Card> : (
        <Card><CardContent className="pt-6"><ul className="divide-y">{camps.campaigns.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="vp-row" data-status={c.status}>
            <Link className="min-w-0 flex-1 basis-60 break-words font-medium text-primary hover:underline" href={`/vendor/orders/preorders/${c.id}`}>{c.title} <span className="text-xs font-normal text-muted-foreground">{c.number}</span></Link>
            <Badge variant="secondary">{l[`kind.${c.kind}`]}</Badge>
            <Badge variant={TONE[c.status]}>{l[`status.${c.status}`]}</Badge>
            <span className="text-xs text-muted-foreground">{l.closesLabel} {day(c.closesAt)} · {l.sellerProducts}: {c.items} · {l.sellerBuyers}: {c.buyers}</span>
          </li>
        ))}</ul></CardContent></Card>
      ))}
      {locks && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="size-4" /> {l.sellerLocks}</CardTitle></CardHeader>
            <CardContent>{!locks.locks.filter((x) => x.status === "REQUESTED").length ? <p className="text-sm text-muted-foreground">{l.sellerNoLocks}</p> : (
              <ul className="divide-y">{locks.locks.filter((x) => x.status === "REQUESTED").map((x) => (
                <li key={x.id} className="space-y-2 py-3 text-sm" data-testid="vl-request">
                  <p><b>{x.buyer}</b> · {x.product} <span className="text-xs text-muted-foreground">{x.pack}</span> · {x.qtyTotal} × {eur(x.unitNet)} · {fill(l.sellerMonths, { n: x.months })} <span className="text-xs text-muted-foreground">{x.number}</span></p>
                  {x.note && <p className="text-muted-foreground">“{x.note}”</p>}
                  {manage && <LockDecision l={l} id={x.id} price={x.unitNet} maxDeposit={locks.settings.maxDepositPct} deposits={locks.settings.parts.deposits} />}
                </li>
              ))}</ul>
            )}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{l.sellerLocksActive}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {locks.committed.length > 0 && <div><p className="mb-1 text-xs font-medium">{l.sellerCommitted}</p><ul className="text-sm" data-testid="vl-committed">{locks.committed.map((c) => <li key={c.offerId}>{c.product}: <b className="tabular-nums">{c.left}</b> <span className="text-xs text-muted-foreground">({l.sellerPerMonth} {c.perMonth})</span></li>)}</ul></div>}
              <ul className="divide-y">{locks.locks.filter((x) => x.status !== "REQUESTED").map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="vl-lock">
                  <span className="min-w-0 flex-1 basis-60 break-words">{x.buyer} · {x.product} · {eur(x.unitNet)} · {fill(l.taken, { taken: x.qtyTaken, total: x.qtyTotal })}{x.validUntil ? ` · ${fill(l.until, { date: day(x.validUntil) })}` : ""}</span>
                  <Badge variant={TONE[x.status]}>{l[`lockStatus.${x.status}`]}</Badge>
                </li>
              ))}</ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
