import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/analytics/kit";
import { listActivity } from "@/server/ai/feed";
import { aiPage } from "../_kit";

export const metadata = { title: "AI Activity Log" };
const KINDS = ["ASSISTANT", "REFRESH", "ACCEPT", "DISMISS", "SETTINGS"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const { ctx } = await aiPage();
  const sp = await searchParams;
  const kind = KINDS.includes(sp.kind as (typeof KINDS)[number]) ? sp.kind : undefined;
  const log = await listActivity(ctx, { kind, page: Number(sp.page) || 1 });
  const href = (p: Record<string, string | number | undefined>) => `?${new URLSearchParams(Object.entries({ kind, ...p }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`;
  return (
    <>
      <PageHeader title="AI Activity Log" description="Everything FIRINGI's AI did: assistant answers (who asked, which data it looked at, tokens used), insight refreshes, and suggestions people accepted or dismissed." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="ai-usage">
        <Kpi label="AI events, 30 days" value={log.last30.events} fmt="number" locale="en" index={0} />
        <Kpi label="Input tokens, 30 days" value={log.last30.tokensIn} fmt="number" locale="en" index={1} />
        <Kpi label="Output tokens, 30 days" value={log.last30.tokensOut} fmt="number" locale="en" index={2} />
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <Link href={href({ kind: undefined, page: undefined })} className={!kind ? "font-semibold" : "text-muted-foreground hover:underline"}>all</Link>
        {KINDS.map((k) => <Link key={k} href={href({ kind: k, page: undefined })} className={kind === k ? "font-semibold" : "text-muted-foreground hover:underline"}>{k.toLowerCase()}</Link>)}
      </div>
      <Card><CardContent className="pt-4">
        <Table data-testid="activity-log">
          <THead><TR><TH>When</TH><TH>What</TH><TH>Who</TH><TH>Summary</TH><TH>Model</TH><TH className="text-right">Tokens in / out</TH></TR></THead>
          <TBody>
            {log.rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap tabular-nums text-xs">{r.at.toISOString().slice(0, 16).replace("T", " ")}</TD>
                <TD><Badge variant={r.kind === "ASSISTANT" ? "default" : r.kind === "ACCEPT" ? "success" : "secondary"}>{r.kind.toLowerCase()}</Badge></TD>
                <TD className="text-sm">{r.actor}{r.company && <div className="text-xs text-muted-foreground">{r.company}</div>}</TD>
                <TD className="max-w-xl text-sm">{r.summary}</TD>
                <TD className="text-xs">{r.model ?? "—"}</TD>
                <TD className="text-right tabular-nums text-xs">{r.tokensIn || r.tokensOut ? `${r.tokensIn.toLocaleString("en")} / ${r.tokensOut.toLocaleString("en")}` : "—"}</TD>
              </TR>
            ))}
            {!log.rows.length && <EmptyRow colSpan={6}>No AI activity yet.</EmptyRow>}
          </TBody>
        </Table>
        {log.pages > 1 && <div className="mt-3 flex gap-3 text-sm">{log.page > 1 && <Link href={href({ page: log.page - 1 })}>← Newer</Link>}<span className="text-muted-foreground">Page {log.page} of {log.pages}</span>{log.page < log.pages && <Link href={href({ page: log.page + 1 })}>Older →</Link>}</div>}
      </CardContent></Card>
    </>
  );
}
