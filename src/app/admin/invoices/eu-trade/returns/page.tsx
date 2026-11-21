import Link from "next/link";
import { Globe2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listReturns } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ReturnsTable } from "@/components/trade/views";

export const metadata = { title: "EU Trade Returns" };
export const dynamic = "force-dynamic";

const KINDS = [["", "All"], ["ECSL", "EC Sales List"], ["ARRIVALS", "Arrivals"], ["DISPATCHES", "Dispatches"]];
const STATUSES = [["", "Any status"], ["OPEN", "Open"], ["READY", "Ready"], ["FILED", "Filed"]];

export default async function EuTradeReturnsPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; year?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.tax.manage", "admin.invoices.view"]);
  const f = await searchParams;
  const rows = await listReturns(ctx, f);
  const q = (o: Record<string, string>) => `?${new URLSearchParams({ ...(f.kind ? { kind: f.kind } : {}), ...(f.status ? { status: f.status } : {}), ...o }).toString()}`;
  return (
    <>
      <PageHeader title="EU Trade Returns" icon={Globe2} description="Every EC Sales List and Intrastat return, its status and the submission reference once filed." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {KINDS.map(([k, l]) => <Link key={k} href={q({ kind: k })} className={`rounded-full border px-3 py-1 ${(f.kind ?? "") === k ? "bg-primary text-primary-foreground" : ""}`}>{l}</Link>)}
        <span className="mx-1 border-l" />
        {STATUSES.map(([k, l]) => <Link key={k} href={q({ status: k })} className={`rounded-full border px-3 py-1 ${(f.status ?? "") === k ? "bg-primary text-primary-foreground" : ""}`}>{l}</Link>)}
      </div>
      <Card><CardContent className="pt-5"><ReturnsTable rows={rows} /></CardContent></Card>
    </>
  );
}
