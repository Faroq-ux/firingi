import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listApprovals } from "@/server/approvals/service";
import { approvalSettings } from "@/server/approvals/gate";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ApprovalDecision, ApprovalSettingsForm } from "@/components/risk/forms";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Approval Workflows" };
const TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "secondary", FAILED: "destructive" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ show?: string; id?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.users.view", "admin.users.manage", "admin.finance.view", "admin.settings.view", "admin.marketing.manage", "admin.customers.manage"]);
  const sp = await searchParams;
  const show = sp.show === "all" ? "all" : "pending";
  const [rows, settings] = await Promise.all([listApprovals(ctx, show === "pending" ? "PENDING" : undefined), approvalSettings()]);
  return (
    <>
      <PageHeader title="Approval Workflows" description="Four-eyes: sensitive actions above a threshold wait for a second person — never the one who asked, and with the same right. Approving runs the action exactly as requested." />
      <div className="mb-4 flex gap-2 text-sm">{(["pending", "all"] as const).map((s) => <Link key={s} href={`?show=${s}`} className={`rounded-md border px-3 py-1 ${s === show ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{s === "pending" ? "Waiting" : "All"}</Link>)}</div>
      <Card className="mb-4">
        <CardContent className="pt-5">
          <Table data-testid="approvals-table">
            <THead><TR><TH>Request</TH><TH className="text-right">Amount</TH><TH>Asked by</TH><TH>Status</TH><TH>Decision</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={r.id === sp.id ? "bg-[color-mix(in_oklch,var(--vivid-violet)_10%,transparent)]" : ""}>
                  <TD><div className="text-xs font-semibold uppercase text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]">{r.kindLabel}</div><div>{r.summary}</div></TD>
                  <TD className="text-right tabular-nums">{r.amount ? formatMoney(r.amount.toString(), "en") : "—"}</TD>
                  <TD className="text-xs">{r.requestedBy}<div className="text-muted-foreground">{formatDate(r.requestedAt, "en-GB", true)}</div></TD>
                  <TD><Badge variant={TONE[r.status]}>{r.status.toLowerCase()}</Badge>{r.decidedBy && <div className="text-xs text-muted-foreground">by {r.decidedBy}</div>}{r.reason && <div className="text-xs">{r.reason}</div>}{r.error && <div className="text-xs text-destructive">{r.error}</div>}</TD>
                  <TD className="min-w-72">{r.status === "PENDING" ? <ApprovalDecision id={r.id} canDecide={r.canDecide} canWithdraw={r.canWithdraw} /> : null}{r.status === "PENDING" && !r.canDecide && !r.canWithdraw && <span className="text-xs text-muted-foreground">waiting for someone with the right</span>}</TD>
                </TR>
              ))}
              {!rows.length && <EmptyRow colSpan={5}>{show === "pending" ? "Nothing waiting for approval." : "No requests yet."}</EmptyRow>}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What needs a second person</CardTitle></CardHeader>
        <CardContent>{can(ctx, "admin.settings.manage") ? <ApprovalSettingsForm settings={settings} /> : (
          <ul className="list-disc pl-5 text-sm">
            <li>Credit notes above {formatMoney(settings.creditNoteAbove, "en")}; payments above {formatMoney(settings.paymentAbove, "en")}</li>
            <li>Credit limits raised above {formatMoney(settings.creditLimitAbove, "en")} or payment terms above {settings.paymentDaysAbove} days</li>
            <li>FIRINGI-paid offers above {settings.offerPercentAbove} % or {formatMoney(settings.offerAmountAbove, "en")}; commission changes; FIRINGI&apos;s IBAN; powerful staff roles</li>
          </ul>
        )}</CardContent>
      </Card>
    </>
  );
}
