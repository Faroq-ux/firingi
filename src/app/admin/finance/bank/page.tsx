import { BankWorkspace } from "@/components/bank/workspace";

export const metadata = { title: "Bank Reconciliation" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; account?: string; q?: string; feed?: string }> }) {
  return <BankWorkspace portal="admin" tab="lines" sp={await searchParams} />;
}
