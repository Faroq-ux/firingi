import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/ui/pager";
import { RecDecision, RefreshInsights } from "@/components/ai/actions";
import { ensureFresh } from "@/server/ai/feed";
import { areaRecommendations } from "@/server/ai/centre/dashboard";
import { REC_LABEL, type RecKind } from "@/lib/ai";
import { AREA_HINT, AREA_LABEL, CENTRE_KIND_LABEL, KIND_AREA, REC_AREAS, kindsOf, type AnyRecKind, type CentreKind, type RecArea } from "@/lib/ai-centre";
import { SuggestOnly, TabLinks, aiPage } from "../_kit";
import { AreaInsights } from "../_insights";

export const metadata = { title: "Recommendations" };
export const dynamic = "force-dynamic";
const STATUSES = ["OPEN", "ACCEPTED", "DISMISSED", "EXPIRED", "ALL"] as const;
type Status = (typeof STATUSES)[number];
const label = (k: string) => REC_LABEL[k as RecKind] ?? CENTRE_KIND_LABEL[k as CentreKind] ?? k;
const ACCEPT: Partial<Record<AnyRecKind, string>> = {
  REORDER_DUE: "Create call task", STOCK_OUT: "Tell the supplier", CUSTOMER_LAPSING: "Create call task", OVERDUE_PAYMENT: "Create chase task",
  PRICE_REVIEW: "Task for the supplier", COMMISSION_REVIEW: "Task: review commission", SALES_DROP: "Task: talk to supplier", ROUTE_SAVING: "Use the shorter order", ROUTE_MERGE: "Noted",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ area?: string; status?: string; kind?: string; page?: string }> }) {
  const { ctx } = await aiPage();
  await ensureFresh().catch(() => null);
  const sp = await searchParams;
  const area = (REC_AREAS as readonly string[]).includes(sp.area ?? "") ? (sp.area as RecArea) : "ALL";
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "OPEN";
  const kind = sp.kind && KIND_AREA[sp.kind as AnyRecKind] ? sp.kind : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await areaRecommendations(ctx, area, { status, kind, page });
  const q = (p: Record<string, string | undefined>) => `/admin/ai/recommendations?${new URLSearchParams(Object.entries({ area: area === "ALL" ? undefined : area, status: status === "OPEN" ? undefined : status, kind: kind ?? undefined, ...p }).filter(([, v]) => v) as [string, string][])}`;
  const areas = REC_AREAS.filter((a) => r.enabled[a]);
  return (
    <>
      <PageHeader title="Recommendations" icon={Lightbulb} actions={<RefreshInsights />}
        description="Suggestions for sales, pricing, suppliers, stock, customers and delivery routes, computed every hour. Accepting does the small next step (a call task, a notice to the supplier, the shorter stop order); dismissing hides it." />
      <SuggestOnly />
      <TabLinks testid="rec-areas" active={area} href={(k) => q({ area: k === "ALL" ? undefined : k, kind: undefined, page: undefined })}
        tabs={[{ key: "ALL", label: "All", count: areas.reduce((n, a) => n + r.byArea[a], 0) }, ...areas.map((a) => ({ key: a, label: AREA_LABEL[a], count: r.byArea[a] }))]} />
      {area !== "ALL" && <p className="-mt-2 mb-3 text-sm text-muted-foreground" data-testid="rec-area-hint">{AREA_HINT[area]}</p>}
      {area !== "ALL" && (
        <div className="mb-3 flex flex-wrap gap-2" data-testid="rec-kinds">
          <Link href={q({ kind: undefined, page: undefined })} className={`rounded-full border px-2.5 py-0.5 text-xs ${!kind ? "border-primary bg-primary/10 font-medium" : ""}`}>All kinds</Link>
          {kindsOf(area).filter((k) => k !== "LOW_COVER").map((k) => <Link key={k} href={q({ kind: k, page: undefined })} className={`rounded-full border px-2.5 py-0.5 text-xs ${kind === k ? "border-primary bg-primary/10 font-medium" : ""}`}>{label(k)} <span className="tabular-nums text-muted-foreground">{r.byKind[k] ?? 0}</span></Link>)}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-3 text-sm" data-testid="rec-status">{STATUSES.map((s) => <Link key={s} href={q({ status: s === "OPEN" ? undefined : s, page: undefined })} className={status === s ? "font-semibold" : "text-muted-foreground hover:underline"}>{s.toLowerCase()}</Link>)}</div>
      <Card><CardContent className="overflow-x-auto pt-4">
        <Table data-testid="recommendations">
          <THead><TR><TH>Suggestion</TH><TH>Area</TH><TH className="text-right">Importance</TH><TH>Since</TH><TH /></TR></THead>
          <TBody>
            {r.rows.map((x) => (
              <TR key={x.id} data-testid="rec-row" data-kind={x.kind}>
                <TD className="max-w-xl"><span className="break-words">{x.title}</span><div className="text-xs text-muted-foreground">{label(x.kind)}</div></TD>
                <TD><Badge variant="secondary">{AREA_LABEL[KIND_AREA[x.kind as AnyRecKind] ?? "SALES"]}</Badge></TD>
                <TD className="text-right"><span className="inline-flex items-center gap-2 tabular-nums"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-pink))]" style={{ width: `${x.score}%` }} /></span>{x.score}</span></TD>
                <TD className="tabular-nums text-xs">{x.createdAt.toISOString().slice(0, 10)}</TD>
                <TD>{x.status === "OPEN" ? <RecDecision id={x.id} acceptLabel={ACCEPT[x.kind as AnyRecKind] ?? "Done"} /> : <Badge variant={x.status === "ACCEPTED" ? "success" : "outline"}>{x.status.toLowerCase()}</Badge>}</TD>
              </TR>
            ))}
            {!r.rows.length && <EmptyRow colSpan={5}>{status === "OPEN" ? "No open suggestions here — all clear." : "Nothing here."}</EmptyRow>}
          </TBody>
        </Table>
        <Pager page={r.page} pageCount={r.pages} basePath="/admin/ai/recommendations" params={{ area: area === "ALL" ? undefined : area, status: status === "OPEN" ? undefined : status, kind: kind ?? undefined }} />
      </CardContent></Card>
      {area !== "ALL" && <AreaInsights ctx={ctx} area={area} />}
    </>
  );
}
