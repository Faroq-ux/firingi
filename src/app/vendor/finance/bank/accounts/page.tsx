import { BankWorkspace } from "@/components/bank/workspace";

export const metadata = { title: "Bank" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; account?: string; q?: string; feed?: string }> }) {
  return <BankWorkspace portal="vendor" tab="accounts" sp={await searchParams} />;
}
