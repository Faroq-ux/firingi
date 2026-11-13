import Link from "next/link";
import { ReceiptEuro } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listChargebacks } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Kpi } from "@/components/analytics/kit";
import { CHARGEBACK_TONE } from "@/components/claims/views";
import { ResolveChargeback } from "@/components/claims/forms";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Claim Charge-backs" };
const eur = (v: number) => formatMoney(v, "pt-PT");
const STATUSES = ["OPEN", "DISPUTED", "DEDUCTED", "WAIVED"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; target?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.claims.manage", "admin.finance.view", "admin.fleet.view"]);
  const sp = await searchParams;
  const status = STATUSES.find((x) => x === sp.status);
  const target = sp.target === "SUPPLIER" || sp.target === "DRIVER" ? sp.target : undefined;
  const all = await listChargebacks(ctx, "ADMIN", { target });
  const rows = status ? all.filter((r) => r.status === status) : all;
  const sum = (f: (r: (typeof all)[number]) => boolean) => all.filter(f).reduce((a, r) => a + r.amount, 0);
  const manage = can(ctx, "admin.claims.manage");
  return (
    <>
      <PageHeader title="Claim Charge-backs" description="Who pays for upheld claims. Supplier charge-backs go on a credit billing statement — the supplier issues its credit note to FIRINGI and it is netted off its payout; they settle when that credit note is matched. FIRINGI driver charge-backs (fee-paid deliveries only, at most the per-delivery pay) are deducted from the driver's pay." icon={ReceiptEuro} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open" value={sum((r) => r.status === "OPEN")} fmt="money" locale="en" index={0} />
        <Kpi label="Disputed by suppliers" value={sum((r) => r.status === "DISPUTED")} fmt="money" locale="en" index={1} />
        <Kpi label="Deducted" value={sum((r) => r.status === "DEDUCTED")} fmt="money" locale="en" index={2} />
        <Kpi label="Waived (FIRINGI carried)" value={sum((r) => r.status === "WAIVED")} fmt="money" locale="en" index={3} />
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <Link href={`?${target ? `target=${target}` : ""}`} className={!status ? "font-semibold" : "text-muted-foreground hover:underline"}>All</Link>
        {STATUSES.map((x) => <Link key={x} href={`?status=${x}${target ? `&target=${target}` : ""}`} className={status === x ? "font-semibold" : "text-muted-foreground hover:underline"}>{x.toLowerCase()}</Link>)}
        <span className="ml-auto flex gap-3">{(["SUPPLIER", "DRIVER"] as const).map((x) => <Link key={x} href={`?target=${x}${status ? `&status=${status}` : ""}`} className={target === x ? "font-semibold" : "text-muted-foreground hover:underline"}>{x === "SUPPLIER" ? "Suppliers" : "FIRINGI drivers"}</Link>)}</span>
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="admin-chargebacks">
          <THead><TR><TH>Claim</TH><TH>Who</TH><TH className="text-right">Amount</TH><TH>Status</TH><TH>Settles through</TH><TH>Notes</TH><TH /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/admin/orders/claims/${r.claimId}`} className="font-medium text-primary hover:underline">{r.claimNumber}</Link><div className="text-xs text-muted-foreground">{r.orderNumber}</div></TD>
                <TD>{r.who}<div className="text-xs text-muted-foreground">{r.target === "SUPPLIER" ? "supplier" : "FIRINGI driver"}</div></TD>
                <TD className="text-right font-semibold tabular-nums">{eur(r.amount)}</TD>
                <TD><Badge variant={CHARGEBACK_TONE[r.status]}>{r.status.toLowerCase()}</Badge></TD>
                <TD className="text-xs">{r.statement ? <>{r.statement.number} <span className="text-muted-foreground">({r.statement.status.toLowerCase()})</span></> : r.target === "DRIVER" ? "driver pay" : "—"}{r.deductedRef ? <div className="text-muted-foreground">{r.deductedRef}</div> : null}</TD>
                <TD className="max-w-60 break-words text-xs">{r.disputeNote && <div>Supplier: {r.disputeNote}</div>}{r.resolutionNote && <div className="text-muted-foreground">FIRINGI: {r.resolutionNote}</div>}</TD>
                <TD>{manage && <ResolveChargeback id={r.id} status={r.status} target={r.target} />}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={7}>No charge-backs.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
