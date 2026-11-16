import Link from "next/link";
import { Banknote } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listEarlyPayouts } from "@/server/plans/early-pay";
import { plansOverview } from "@/server/plans/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EarlyPayoutDecision, PlansTabs } from "@/components/plans/admin";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Early Payouts" };
export const dynamic = "force-dynamic";

const TONE = { REQUESTED: "warning", PAID: "success", REJECTED: "destructive", CANCELLED: "outline" } as const;
const MODEL: Record<string, string> = { PER_DAY: "% per day", FLAT: "flat %", FREE: "free (plan)" };

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const all = (await searchParams).all === "1";
  const [rows, o] = await Promise.all([listEarlyPayouts(ctx, all ? undefined : "REQUESTED"), plansOverview(ctx)]);
  const manage = ctx.permissions.has("admin.finance.manage");
  const eur = (n: unknown) => formatMoney(String(n), "en-GB");
  return (
    <>
      <PageHeader title="Early Payouts" icon={Banknote}
        description="Suppliers asking to be paid before their invoices are due. Send the bank transfer, then mark it paid: FIRINGI's fee invoice is issued and settled against the same invoices, which end up fully paid. Payments above the four-eyes threshold need a second person." />
      <PlansTabs active="/admin/vendors/plans/early-payouts" pending={o.pendingEarly} />
      <div className="mb-3 flex gap-2 text-sm">
        <Link href="?" className={`rounded-md border px-3 py-1 ${!all ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Waiting</Link>
        <Link href="?all=1" className={`rounded-md border px-3 py-1 ${all ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>All</Link>
      </div>
      <Card><CardContent className="pt-4">
        {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="early-empty">Nothing waiting.</p> : (
          <ul className="divide-y" data-testid="early-list">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1.5 py-3 text-sm" data-testid="early-admin-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.number}</span>
                  <span className="font-medium">{r.company}</span>
                  <Badge variant={TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(r.createdAt, "en-GB", true)}</span>
                </div>
                <p>Invoices {eur(r.amount)} · fee {Number(r.fee) > 0 ? `${eur(r.fee)} + VAT (${MODEL[r.model] ?? r.model}${r.model === "PER_DAY" || r.model === "FLAT" ? ` ${Number(r.rate)} %` : ""})` : "none"} · <span className="font-medium">transfer {eur(r.status === "PAID" ? r.net : Number(r.amount) - Number(r.fee))}{r.status === "PAID" ? "" : " + VAT on the fee less"}</span></p>
                <p className="text-xs text-muted-foreground">{r.lines.map((l) => `${l.number} (${eur(l.amount)}, due ${formatDate(l.dueDate, "en-GB")}, ${l.days} days early)`).join(" · ")}</p>
                {r.reason && <p className="text-xs">Reason: {r.reason}</p>}
                {r.reference && <p className="text-xs text-muted-foreground">Reference: {r.reference}</p>}
                {manage && r.status === "REQUESTED" && <EarlyPayoutDecision id={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </>
  );
}
