import { pagePortal } from "@/server/rbac/guard";
import { AccountingOverview } from "@/components/accounting/pages";

export const metadata = { title: "Accounting" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("buy");
  return <AccountingOverview ctx={ctx} portal="buy" sp={await searchParams} />;
}
