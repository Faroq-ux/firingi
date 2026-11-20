import Link from "next/link";
import { BadgePercent, Plus } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { ownBonuses } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { fill, rebateLabels, rulesText } from "@/components/rebates/labels";
import { statusLabel } from "@/components/rebates/detail";
import { formatDate, formatMoney } from "@/lib/utils";
import type { RebateRules } from "@/lib/rebates";

export const metadata = { title: "Rebates & Bonuses" };
export const dynamic = "force-dynamic";

export default async function VendorRebatesPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.promotions.manage", "vendor.pricing.manage", "vendor.reports.view"]);
  const [{ l, locale }, o] = await Promise.all([rebateLabels(), ownBonuses(ctx)]);
  const canEdit = ctx.permissions.has("vendor.promotions.manage") || ctx.permissions.has("vendor.pricing.manage");
  return (
    <>
      <PageHeader title={l.vendorTitle} icon={BadgePercent} description={l.vendorIntro}
        actions={o.access.ok && canEdit ? <Link href="/vendor/products/rebates/new" className={buttonVariants()} data-testid="rb-new"><Plus className="size-4" /> {l.newDeal}</Link> : null} />
      {!o.access.ok && <p className="mb-4 rounded-xl border border-dashed p-4 text-sm" data-testid="rb-closed">{l[`closed.${o.access.why}`]}</p>}
      {o.access.ok && <p className="mb-4 text-sm text-muted-foreground">{o.settings.approval === "AUTO" ? l.approvalAuto : l.approvalAlways} {fill(l.maxPct, { pct: o.settings.maxPct })}</p>}
      <Card>
        <CardHeader><CardTitle>{l.yourDeals}</CardTitle></CardHeader>
        <CardContent>
          {!o.rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">{l.noDeals}</p> : (
            <ul className="divide-y" data-testid="rb-list">
              {o.rows.map((b) => {
                const st = statusLabel(l, b, locale);
                return (
                  <li key={b.id} className="space-y-1 py-3 text-sm" data-testid="rb-row" data-status={b.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/vendor/products/rebates/${b.id}`} className="font-medium text-primary hover:underline">{b.name}</Link>
                      <Badge variant="secondary">{l[`kind.${b.kind}`]}</Badge>
                      <Badge variant={st.tone}>{st.text}</Badge>
                      <span className="text-xs text-muted-foreground">{l[`period.${b.period}`]}</span>
                    </div>
                    <p className="break-words text-muted-foreground">{rulesText(l, b.rules as RebateRules, locale)}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(b.validFrom, locale)} → {b.validTo ? formatDate(new Date(b.validTo.getTime() - 86_400_000), locale) : "∞"} · {l.earners}: {b.earners} · {b.kind === "FREE_GOODS" ? `${l.freeGiven}: ${b.freeGiven}` : `${l.paid}: ${formatMoney(b.paid, locale)}`}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
