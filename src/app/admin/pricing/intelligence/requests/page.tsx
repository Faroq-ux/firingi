import { ClipboardCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canManagePricing, listRequests, priceSettings } from "@/server/price-intel/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DecideRequest } from "@/components/price-intel/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Price Change Approvals" };
const TONE = { PENDING: "warning", APPROVED: "success", APPLIED: "outline", REJECTED: "destructive", CANCELLED: "outline" } as const;

export default async function PriceChangeApprovals() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const [rows, s] = await Promise.all([listRequests(ctx, "ALL"), priceSettings()]);
  const pending = rows.filter((r) => r.status === "PENDING");
  const manage = canManagePricing(ctx);
  const listName = (r: (typeof rows)[number]) => r.priceList.scope === "BASE" ? "Base prices" : `${r.priceList.name}${r.priceList.targetCompany ? ` (${r.priceList.targetCompany.legalName})` : r.priceList.targetGroup ? ` (${r.priceList.targetGroup.name})` : ""}`;
  return (
    <>
      <PageHeader title="Price Change Approvals" icon={ClipboardCheck} description={`Supplier increases above ${s.approvalThresholdPct} % wait here. Approved increases apply ${s.noticeDays} days later at the earliest; customers who bought the product in the last ${s.notifyBuyersDays} days (or keep it in a list / recurring order) are told right away. Until then customers pay the old price.`} />
      <div className="mb-6 space-y-3" data-testid="pending-requests">
        {pending.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No price increase is waiting for approval.</p>}
        {pending.map((r) => (
          <Card key={r.id} className="motion-rise">
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.product} <span className="font-normal text-muted-foreground">· {r.packaging}{r.minQty > 1 ? ` · from ${r.minQty}` : ""}</span></p>
                  <p className="text-sm text-muted-foreground">{r.vendor.country.flag} {r.vendor.tradeName ?? r.vendor.legalName} · {listName(r)} · asked {formatDate(r.createdAt, "en", true)}</p>
                  {r.reason && <p className="mt-1 text-sm">“{r.reason}”</p>}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums">{formatMoney(r.oldPrice.toString(), "en")} → {formatMoney(r.newPrice.toString(), "en")}</p>
                  <Badge variant="warning">+{Number(r.changePct).toFixed(1)} %</Badge>
                  {r.market && <p className="mt-1 text-xs text-muted-foreground">market median {formatMoney(r.market.median.toFixed(2), "en")} ({r.market.n} suppliers) — new price {r.market.newVsMedian > 0 ? "+" : ""}{r.market.newVsMedian.toFixed(0)} %</p>}
                </div>
              </div>
              {manage && <DecideRequest id={r.id} noticeDays={s.noticeDays} />}
            </CardContent>
          </Card>
        ))}
      </div>
      <DataTable tableId="admin.price.requests" testId="requests-history" empty="No price changes yet."
        columns={[{ key: "created", label: "Asked", type: "date" }, { key: "product", label: "Product" }, { key: "vendor", label: "Supplier", filter: true }, { key: "change", label: "Change" }, { key: "status", label: "Status", type: "badge", filter: true }, { key: "eff", label: "Applies on", type: "date" }, { key: "told", label: "Customers told", type: "number" }, { key: "note", label: "Note" }]}
        rows={rows.filter((r) => r.status !== "PENDING").map((r) => ({ id: r.id, cells: {
          created: { t: formatDate(r.createdAt, "en"), v: r.createdAt.getTime() }, product: { t: r.product, sub: listName(r) }, vendor: r.vendor.tradeName ?? r.vendor.legalName,
          change: `${formatMoney(r.oldPrice.toString(), "en")} → ${formatMoney(r.newPrice.toString(), "en")} (+${Number(r.changePct).toFixed(1)} %)`,
          status: { t: r.status.toLowerCase(), tone: TONE[r.status] }, eff: { t: formatDate(r.effectiveAt, "en"), v: r.effectiveAt?.getTime() ?? 0 }, told: r.noticeSent, note: r.decisionNote ?? "—",
        } }))} />
    </>
  );
}
