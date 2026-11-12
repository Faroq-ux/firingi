import { pagePortal } from "@/server/rbac/guard";
import { AccountingSales } from "@/components/accounting/pages";

export const metadata = { title: "Daily sales" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pagePortal("vendor");
  return <AccountingSales ctx={ctx} portal="vendor" sp={await searchParams} />;
}
