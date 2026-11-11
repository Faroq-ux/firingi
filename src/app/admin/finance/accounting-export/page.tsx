import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { FORMATS, FORMAT_LABEL, JOURNALS, JOURNAL_LABEL, accountMap } from "@/server/integrations/accounting";
import { IntegrationsHero } from "@/components/integrations/hero";
import { AccountingExport } from "@/components/admin/accounting-export";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounting export" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.invoices.view"]);
  const mapping = await accountMap();
  return (
    <>
      <IntegrationsHero title="Accounting export" locale="en" stats={[]}
        subtitle="FIRINGI's books for the accountant: sales, credit notes, receipts, supplier invoices and payouts — as documents or as balanced journal entries for PHC, Primavera or Sage." />
      <AccountingExport journals={JOURNALS.map((j) => ({ key: j, label: JOURNAL_LABEL[j] }))} formats={FORMATS.map((f) => ({ key: f, label: FORMAT_LABEL[f] }))} mapping={mapping} />
    </>
  );
}
