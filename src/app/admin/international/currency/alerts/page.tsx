import { BellRing } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { fxEvents } from "@/server/currency/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { AckButton } from "@/components/currency/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Rate Alerts" };
export const dynamic = "force-dynamic";

const KIND: Record<string, { label: string; v: "destructive" | "warning" | "secondary" | "default" }> = {
  MOVE: { label: "Big move", v: "warning" }, FEED_FAILED: { label: "Feed failed", v: "destructive" }, STALE: { label: "Stale rate", v: "destructive" }, OVERRIDE: { label: "Set by hand", v: "secondary" },
};

export default async function RateAlertsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage", "admin.settings.view", "admin.finance.view"]);
  const rows = await fxEvents();
  const manage = can(ctx, ["admin.settings.manage", "admin.international.manage", "admin.finance.manage"]);
  const open = rows.filter((r) => !r.ackAt).length;
  return (
    <>
      <PageHeader title="Rate Alerts" icon={BellRing} description="Big daily moves, a feed that could not be read, rates older than allowed, and rates set by hand. The thresholds are in Currencies." actions={manage && open > 0 ? <AckButton id="ALL" label={`Mark all ${open} seen`} /> : undefined} />
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="fx-alerts">
          <THead><TR><TH>When</TH><TH>Kind</TH><TH>Currency</TH><TH>What happened</TH><TH /></TR></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={5}>No alerts.</EmptyRow>}
            {rows.map((r) => (
              <TR key={r.id} className={r.ackAt ? "opacity-70" : ""}>
                <TD className="whitespace-nowrap text-xs">{formatDate(r.createdAt, "en-GB", true)}</TD>
                <TD><Badge variant={KIND[r.kind]?.v ?? "default"}>{KIND[r.kind]?.label ?? r.kind}</Badge></TD>
                <TD className="font-medium">{r.currencyCode ?? "—"}</TD>
                <TD className="min-w-0 max-w-md break-words text-sm">{r.message}</TD>
                <TD>{!r.ackAt && manage ? <AckButton id={r.id} /> : r.ackAt ? <span className="text-xs text-muted-foreground">seen</span> : null}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
