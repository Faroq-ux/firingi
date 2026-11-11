import Link from "next/link";
import { BellRing } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminPurchaseAlerts, ALERT_EVENT } from "@/server/inventory/purchased";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CompanyAlertSwitch, PurchaseAlertsForm } from "@/components/inventory/admin-controls";

export const metadata = { title: "Expiry Alerts" };

export default async function ExpiryAlerts() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const manage = can(ctx, "admin.inventory.manage");
  const a = await adminPurchaseAlerts(ctx);
  const tpl = (locale: string) => `/admin/notifications/templates?event=${ALERT_EVENT}&channel=EMAIL&locale=${locale}`;
  return (
    <>
      <PageHeader title="Expiry Alerts" icon={BellRing} description="Wholesalers (buying from distributors) and customers (buying from wholesalers to resell) are reminded twice before goods they bought on FIRINGI reach their best-before date — only goods bought on FIRINGI, and only what is still unsold." />
      <Card className="mb-6">
        <CardHeader><CardTitle>When</CardTitle><CardDescription>Two alerts, each 1–30 days before the best-before date. A lot that arrives already inside the second window only gets the second alert. {a.sentLast30} alert(s) sent in the last 30 days.</CardDescription></CardHeader>
        <CardContent><PurchaseAlertsForm value={a.settings} canManage={manage} /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Message</CardTitle><CardDescription>Placeholders: {"{count}"} products, {"{days}"} days before, {"{products}"} the products (first three). E-mail, push and in-app use the same event; each language has its own text.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2" data-testid="edit-message">
          {[["pt-PT", "Portuguese"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"]].map(([l, n]) => <Link key={l} className="rounded-full border px-3 py-1 text-sm hover:bg-accent" href={tpl(l)}>Edit {n}</Link>)}
          <Link className="rounded-full border px-3 py-1 text-sm hover:bg-accent" href={`/admin/notifications/templates?event=${ALERT_EVENT}`}>All languages →</Link>
        </CardContent>
      </Card>
      <Table data-testid="alert-companies">
        <THead><TR><TH>Company</TH><TH>Type</TH><TH className="text-right">Lots expiring in 30 days</TH><TH>Alerts</TH><TH /></TR></THead>
        <TBody>
          {a.companies.map((c) => (
            <TR key={c.id} data-testid="alert-company-row">
              <TD className="font-medium">{c.name}</TD>
              <TD>{c.type === "WHOLESALER" ? "Wholesaler" : "Customer"}</TD>
              <TD className="text-right tabular-nums">{c.expiringLots || ""}</TD>
              <TD><Badge variant={c.enabled ? "success" : "secondary"}>{c.enabled ? "on" : "off"}{c.override === null ? " (global)" : ""}</Badge></TD>
              <TD className="text-right"><CompanyAlertSwitch companyId={c.id} value={c.override} canManage={manage} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
