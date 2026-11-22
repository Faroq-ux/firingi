import Link from "next/link";
import { getLocale } from "next-intl/server";
import { ExternalLink, Store } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { baseUrl, myStorefront, ownProducts } from "@/server/storefront/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CopyLink, ImageField, PublishControls, StorefrontEditor } from "@/components/storefront/client";
import { fill, sfLabels } from "@/components/storefront/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Storefront" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "success" | "warning" | "secondary" | "destructive"> = { DRAFT: "secondary", PENDING: "warning", PUBLISHED: "success", SUSPENDED: "destructive" };

export default async function VendorStorefrontPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.profile.manage", "vendor.products.manage", "vendor.products.view", "vendor.dashboard.view"]);
  const locale = await getLocale();
  const [{ l }, v, products] = await Promise.all([sfLabels(), myStorefront(ctx), ownProducts(ctx, locale)]);
  const s = v.store;
  const canEdit = ctx.permissions.has("company.profile.manage") || ctx.permissions.has("vendor.products.manage");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short" });
  const tiles = [
    { label: l.views, value: String(v.stats.views30) },
    { label: l.signups, value: String(v.stats.signups30) },
    { label: l.customers, value: `${v.stats.customers} · ${l.approved} ${v.stats.approved}` },
    { label: l.ordersFrom, value: `${v.stats.orders} · ${formatMoney(v.stats.ordersNet, locale)}` },
  ];
  return (
    <>
      <PageHeader title={l.title} description={l.intro} icon={Store}
        actions={s.exists ? <Link href={`/s/${s.slug}`} target="_blank" className={buttonVariants({ variant: "outline" })} data-testid="sf-view"><ExternalLink className="size-4" /> {l.view}</Link> : undefined} />
      {!v.settings.enabled && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="sf-off">{l.off}</p>}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
        <Badge variant={TONE[s.status]} data-testid="sf-status" data-status={s.status}>{l[`status.${s.status}`]}</Badge>
        <span className="min-w-0 flex-1 basis-56 break-all font-mono text-sm" data-testid="sf-url">{v.url}</span>
        <CopyLink l={l} url={v.url} />
        {canEdit && s.exists && v.settings.enabled && <PublishControls l={l} status={s.status} requireApproval={v.settings.requireApproval} everPublished={!!s.publishedAt} />}
        {s.status === "PENDING" && <p className="w-full text-sm text-muted-foreground">{l.pendingNote}</p>}
        {s.reviewNote && <p className="w-full text-sm" data-testid="sf-review-note">{fill(l.reviewNote, { note: s.reviewNote })}</p>}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sf-stats">
        {tiles.map((x) => <Card key={x.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{x.label}</p><p className="text-lg font-semibold tabular-nums">{x.value}</p></CardContent></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader><CardTitle>{l.title}</CardTitle><CardDescription>{l.fromSettings}{!v.settings.publicProducts ? ` ${l.publicOff}` : ""}</CardDescription></CardHeader>
          <CardContent>{canEdit ? <StorefrontEditor l={l} store={s} products={products} maxFeatured={v.settings.maxFeatured} base={baseUrl()} /> : <p className="text-sm">{s.tagline}</p>}</CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-5 pt-6">
              <ImageField l={l} kind="logo" has={s.hasLogo} src={`/api/storefront/${s.slug}/logo`} disabled={!s.exists || !canEdit} />
              <ImageField l={l} kind="banner" has={s.hasBanner} src={`/api/storefront/${s.slug}/banner`} disabled={!s.exists || !canEdit} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{l.qrTitle}</CardTitle><CardDescription>{l.qrHint}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.qr} alt={v.url} className="mx-auto size-48 rounded-lg border bg-white p-2" data-testid="sf-qr" />
              <a href={v.qr} download={`${s.slug}-qr.png`} className={buttonVariants({ variant: "outline", size: "sm" })}>{l.download}</a>
            </CardContent>
          </Card>
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>{l.customersTitle}</CardTitle></CardHeader>
        <CardContent>
          {!v.customers.length ? <p className="text-sm text-muted-foreground">{l.noCustomers}</p> : (
            <ul className="divide-y" data-testid="sf-customers">
              {v.customers.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{c.name}</span><Badge variant={c.status === "APPROVED" ? "success" : "secondary"}>{c.status === "APPROVED" ? l.approved : "…"}</Badge><span className="text-xs text-muted-foreground">{date.format(new Date(c.at))}</span></li>)}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
