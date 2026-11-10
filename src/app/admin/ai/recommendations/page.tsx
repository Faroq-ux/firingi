import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RecDecision, RefreshInsights } from "@/components/ai/actions";
import { ensureFresh, listRecommendations, recommendationCounts } from "@/server/ai/feed";
import { REC_KINDS, REC_LABEL, type RecKind } from "@/lib/ai";
import { aiPage } from "../_kit";

export const metadata = { title: "Automated Recommendations" };
const STATUSES = ["OPEN", "ACCEPTED", "DISMISSED", "EXPIRED", "ALL"] as const;
const ACCEPT: Partial<Record<RecKind, string>> = { REORDER_DUE: "Create call task", STOCK_OUT: "Tell the supplier" };
const LINK: Partial<Record<RecKind, string>> = {
  REORDER_DUE: "/admin/ai/reorder-predictions", STOCK_OUT: "/admin/ai/stock-predictions", CHEAPER_SUPPLIER: "/admin/ai/supplier-recommendations",
  MARGIN_GAP: "/admin/ai/margin-opportunities", DELIVERY_RISK: "/admin/ai/delivery-risk", DEMAND_SURGE: "/admin/ai/demand-forecasting",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string }> }) {
  const { ctx } = await aiPage();
  await ensureFresh();
  const sp = await searchParams;
  const kind = REC_KINDS.includes(sp.kind as RecKind) ? (sp.kind as RecKind) : undefined;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status as (typeof STATUSES)[number]) : "OPEN";
  const [rows, counts] = await Promise.all([listRecommendations(ctx, "STAFF", { kind, status }), recommendationCounts(ctx)]);
  const q = (p: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ kind, status, ...p }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Automated Recommendations" description="Suggestions FIRINGI's AI computes every hour from orders, stock, prices and supplier records. Accepting does the small next step (a call task for a late reorder, a stock notice to the supplier); dismissing hides it. Nothing changes by itself." actions={<RefreshInsights />} />
      <div className="mb-3 flex flex-wrap gap-2" data-testid="rec-kinds">
        <Link href={q({ kind: undefined })} className={`rounded-full border px-3 py-1 text-sm ${!kind ? "border-primary bg-primary/10 font-medium" : ""}`}>All</Link>
        {REC_KINDS.filter((k) => k !== "LOW_COVER").map((k) => <Link key={k} href={q({ kind: k })} className={`rounded-full border px-3 py-1 text-sm ${kind === k ? "border-primary bg-primary/10 font-medium" : ""}`}>{REC_LABEL[k]} <span className="tabular-nums text-muted-foreground">{counts[k] ?? 0}</span></Link>)}
      </div>
      <div className="mb-3 flex gap-3 text-sm">{STATUSES.map((s) => <Link key={s} href={q({ status: s })} className={status === s ? "font-semibold" : "text-muted-foreground hover:underline"}>{s.toLowerCase()}</Link>)}</div>
      <Card><CardContent className="pt-4">
        <Table data-testid="recommendations">
          <THead><TR><TH>Suggestion</TH><TH>Kind</TH><TH className="text-right">Importance</TH><TH>Since</TH><TH /></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="max-w-xl">{r.title}{LINK[r.kind as RecKind] && <> · <Link className="text-xs text-primary underline-offset-4 hover:underline" href={LINK[r.kind as RecKind]!}>details</Link></>}</TD>
                <TD><Badge variant="secondary">{REC_LABEL[r.kind as RecKind] ?? r.kind}</Badge></TD>
                <TD className="text-right"><span className="inline-flex items-center gap-2 tabular-nums"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-pink))]" style={{ width: `${r.score}%` }} /></span>{r.score}</span></TD>
                <TD className="tabular-nums text-xs">{r.createdAt.toISOString().slice(0, 10)}</TD>
                <TD>{r.status === "OPEN" ? <RecDecision id={r.id} acceptLabel={ACCEPT[r.kind as RecKind] ?? "Done"} /> : <Badge variant={r.status === "ACCEPTED" ? "success" : "outline"}>{r.status.toLowerCase()}</Badge>}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={5}>{status === "OPEN" ? "No open suggestions — all clear." : "Nothing here."}</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
