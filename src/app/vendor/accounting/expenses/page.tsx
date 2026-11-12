import { pagePortal } from "@/server/rbac/guard";
import { AccountingExpenses } from "@/components/accounting/pages";

export const metadata = { title: "Expenses" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("vendor");
  return <AccountingExpenses ctx={ctx} portal="vendor" sp={await searchParams} />;
}
