import Link from "next/link";
import { BadgePercent, Plus, Settings } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminBonuses, rebateSettings, rebatesOverview } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { rebateLabels, rulesText } from "@/components/rebates/labels";
import { statusLabel } from "@/components/rebates/detail";
import { RetryFailed, ReviewBonus } from "@/components/rebates/admin";
import { formatDate, formatMoney } from "@/lib/utils";
import type { RebateRules } from "@/lib/rebates";

export const metadata = { title: "Rebates & Bonuses" };
export const dynamic = "force-dynamic";
const VIEW = ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage", "admin.vendors.view", "admin.finance.view"] as const;

export default async function AdminRebatesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, [...VIEW]);
  const [{ l }, o, rows, s] = await Promise.all([rebateLabels(true), rebatesOverview(ctx), adminBonuses(ctx), rebateSettings()]);
  const manage = ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"].some((p) => ctx.permissions.has(p as never));
  const pending = rows.filter((r) => r.status === "PENDING");
  const money = (n: number) => formatMoney(n, "en");
  const tiles = [
    { label: "Waiting for approval", value: String(o.pending), id: "rb-k-pending" }, { label: "Running deals", value: String(o.live), id: "rb-k-live" },
    { label: "Credited this year", value: money(o.paidYear), id: "rb-k-paid" }, { label: "…paid by FIRINGI", value: money(o.firingiYear), id: "rb-k-firingi" },
    { label: "Free units given / taken", value: `${o.freeGiven} / ${o.freeTaken}`, id: "rb-k-free" }, { label: "Settlements to retry", value: String(o.failed), id: "rb-k-failed" },
  ];
  return (
    <>
      <PageHeader title="Rebates & Bonuses" icon={BadgePercent}
        description={`Suppliers reward customers for what they buy over a period (volume, free goods, growth, product mix). FIRINGI approves deals and settles each period by credit note; supplier-funded bonuses come off the supplier's payout. ${s.enabled ? "" : "Switched OFF — no new deals; earned periods are still settled."}`}
        actions={<div className="flex flex-wrap gap-2">
          {manage && s.firingiFunded && <Link href="/admin/pricing/rebates/new" className={buttonVariants({ variant: "outline" })}><Plus className="size-4" /> FIRINGI-funded deal</Link>}
          <Link href="/admin/pricing/rebates/settings" className={buttonVariants({ variant: "outline" })} data-testid="rb-settings-link"><Settings className="size-4" /> Settings & suppliers</Link>
        </div>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => <Card key={t.id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-lg font-semibold tabular-nums" data-testid={t.id}>{t.value}</p></CardContent></Card>)}
      </div>
      {manage && <div className="mb-4"><RetryFailed n={o.failed} /></div>}
      <Card className="mb-6">
        <CardHeader><CardTitle>Waiting for approval</CardTitle></CardHeader>
        <CardContent>
          {!pending.length ? <p className="py-4 text-center text-sm text-muted-foreground">Nothing to check.</p> : (
            <ul className="divide-y" data-testid="rb-pending">
              {pending.map((b) => (
                <li key={b.id} className="space-y-2 py-3 text-sm" data-testid="rb-pending-row">
                  <div className="flex flex-wrap items-center gap-2"><Link href={`/admin/pricing/rebates/${b.id}`} className="font-medium text-primary hover:underline">{b.name}</Link><Badge variant="secondary">{l[`kind.${b.kind}`]}</Badge><span className="text-xs text-muted-foreground">{b.supplier} · {l[`period.${b.period}`]} · from {formatDate(b.validFrom, "en")}</span></div>
                  <p className="break-words text-muted-foreground">{rulesText(l, b.rules as RebateRules, "en")} · {l[`audience.${b.audience}`]}</p>
                  {manage && <ReviewBonus id={b.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>All deals</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" data-testid="rb-all">
              <thead className="text-left text-xs text-muted-foreground [&>tr>th]:pb-2 [&>tr>th]:pr-3"><tr><th>Deal</th><th>Supplier</th><th>Kind</th><th>Status</th><th>Funded by</th><th className="text-right">Credited</th><th className="text-right">Free units</th><th className="text-right">Rewarded</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((b) => {
                  const st = statusLabel(l, b, "en");
                  return (
                    <tr key={b.id} className="[&>td]:py-2 [&>td]:pr-3">
                      <td><Link href={`/admin/pricing/rebates/${b.id}`} className="text-primary hover:underline">{b.name}</Link></td>
                      <td>{b.supplier}</td><td>{l[`kind.${b.kind}`]}</td><td><Badge variant={st.tone}>{st.text}</Badge></td><td>{b.fundedBy === "FIRINGI" ? "FIRINGI" : "Supplier"}</td>
                      <td className="text-right tabular-nums">{money(b.paid)}</td><td className="text-right tabular-nums">{b.freeGiven}</td><td className="text-right tabular-nums">{b.earners}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No deals yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
