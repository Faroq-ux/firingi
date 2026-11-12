import { pagePortal } from "@/server/rbac/guard";
import { AccountingPnl } from "@/components/accounting/pages";

export const metadata = { title: "Profit and loss" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("vendor");
  return <AccountingPnl ctx={ctx} portal="vendor" sp={await searchParams} />;
}
