import { BookOpenCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { companiesWithFeatures } from "@/server/accounting/features";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FeatureSwitch } from "@/components/multisite/controls";

export const metadata = { title: "Business Features" };
const TYPE: Record<string, string> = { CUSTOMER: "Customer", WHOLESALER: "Wholesaler", DISTRIBUTOR: "Distributor" };

export default async function BusinessFeatures() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const rows = await companiesWithFeatures(ctx);
  const manage = ctx.permissions.has("admin.settings.manage");
  const on = rows.filter((r) => r.accounting).length;
  const assistants = rows.filter((r) => r.assistant).length;
  return (
    <>
      <PageHeader title="Business Features" icon={BookOpenCheck} description="Optional tools FIRINGI switches on per company. Accounting: daily sales, expenses (rent, utilities, salaries, social security…), purchases on FIRINGI and profit & loss — the company's own bookkeeping; FIRINGI staff never see the figures, only whether it is on. Assistant: FIRINGI's AI support agent for suppliers and customers, in their language (typed or spoken) — it answers about their own orders, deliveries, invoices, statements and claims, helps customers find products and can put them in the cart (the customer always places the order), and passes the chat to FIRINGI support when a person is needed. It only reads the company's own data." />
      <Card className="mb-4"><CardContent className="flex flex-wrap gap-6 pt-6 text-sm"><span>Accounting on for <b>{on}</b> of {rows.length} companies</span><span>Assistant on for <b data-testid="assistant-on-count">{assistants}</b></span><span className="text-muted-foreground">Accounting is off by default; the Assistant is on by default. Switching either off hides it; what the company recorded is kept.</span></CardContent></Card>
      <DataTable tableId="admin.business-features" testId="business-features" empty="No suppliers or customers yet."
        columns={[{ key: "company", label: "Company" }, { key: "type", label: "Type", filter: true }, { key: "country", label: "Country", filter: true }, { key: "accounting", label: "Accounting", type: "badge", filter: true }, { key: "entries", label: "Entries", type: "number" }, { key: "switch", label: "Accounting switch" }, { key: "assistant", label: "Assistant", type: "badge", filter: true }, { key: "assistantSwitch", label: "Assistant switch" }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/admin/companies/${r.id}`,
          cells: {
            company: { t: r.name, href: `/admin/companies/${r.id}`, sub: r.name !== r.legalName ? r.legalName : undefined }, type: TYPE[r.type] ?? r.type, country: r.country,
            accounting: { t: r.accounting ? "On" : "Off", tone: r.accounting ? "success" : "outline" }, entries: r.entries,
            switch: manage ? { t: r.accounting ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.accounting} label={`Accounting for ${r.name}`} /> } : "—",
            assistant: { t: r.assistant ? "On" : "Off", tone: r.assistant ? "success" : "outline" },
            assistantSwitch: manage ? { t: r.assistant ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.assistant} feature="ASSISTANT" label={`Assistant for ${r.name}`} /> } : "—",
          },
        }))} />
    </>
  );
}
