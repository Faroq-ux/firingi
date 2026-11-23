import Link from "next/link";
import { FileBarChart, FileDown, Sheet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { GenerateReport } from "@/components/ai/centre";
import { aiCentreSettings } from "@/server/ai/centre/settings";
import { canReport, generateReport, latestReport, reportHistory, reportRun, type ReportData } from "@/server/ai/centre/reports";
import { assistantStatus } from "@/server/ai/assistant";
import { REPORT_LABEL, REPORTS, type ReportKind } from "@/lib/ai-centre";
import { NoAccess, TabLinks, aiPage, eur } from "../_kit";

export const metadata = { title: "AI Reports" };
export const dynamic = "force-dynamic";
const PERIODS = [7, 30, 90] as const;
const fmt = (v: number, f: string) => (f === "money" ? eur(v) : f === "percent" ? `${v}%` : v.toLocaleString("en"));

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; run?: string; days?: string }> }) {
  const { ctx } = await aiPage();
  const s = await aiCentreSettings();
  const tabs = REPORTS.filter((k) => s.reports[k]);
  const sp = await searchParams;
  const tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as ReportKind) : tabs[0];
  const days = PERIODS.includes(Number(sp.days) as (typeof PERIODS)[number]) ? Number(sp.days) : 7;
  const header = <PageHeader title="AI Reports" icon={FileBarChart} description="Executive, sales, supplier, stock, finance, delivery-risk and fraud reports from FIRINGI's own numbers, with a written summary (by Claude when connected). Download as PDF or CSV; the executive report is emailed to admins every Monday." />;
  if (!tab) return <>{header}<p className="text-sm text-muted-foreground">Every report is switched off in the AI Centre settings.</p></>;
  const nav = <TabLinks testid="rep-tabs" active={tab} href={(k) => `/admin/ai/reports?tab=${k}`} tabs={tabs.map((k) => ({ key: k, label: REPORT_LABEL[k] }))} />;
  if (!canReport(ctx, tab)) return <>{header}{nav}<NoAccess what={`the data of the ${REPORT_LABEL[tab].toLowerCase()} report`} /></>;
  const fresh = (d: Date) => Date.now() - d.getTime() < 24 * 3600_000;
  let run = sp.run ? await reportRun(ctx, sp.run).catch(() => null) : null;
  if (run && run.kind !== tab) run = null;
  if (!run) {
    const last = await latestReport(ctx, tab);
    const lastDays = last ? Math.round((last.periodTo.getTime() - last.periodFrom.getTime()) / 86400_000) : null;
    run = last && fresh(last.createdAt) && (!sp.days || lastDays === days) ? last : await generateReport(ctx, tab, { days });
  }
  const [history, ai] = await Promise.all([reportHistory(ctx, tab), assistantStatus("STAFF")]);
  const d = run.data as unknown as ReportData;
  return (
    <>
      {header}{nav}
      <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="rep-bar">
        <span className="text-sm">Period: {PERIODS.map((p) => <Link key={p} href={`/admin/ai/reports?tab=${tab}&days=${p}`} className={`ml-2 rounded-full border px-2.5 py-0.5 text-xs ${p === days ? "border-primary bg-primary/10 font-medium" : ""}`}>{p} days</Link>)}</span>
        <span className="flex-1" />
        <GenerateReport kind={tab} days={days} claudeOn={ai.configured && s.claudeSummaries} />
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/admin/ai/reports/${run.id}`} target="_blank" rel="noreferrer" data-testid="rep-pdf"><FileDown className="size-4" /> PDF</a>
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/admin/ai/reports/${run.id}?format=csv`} data-testid="rep-csv"><Sheet className="size-4" /> CSV</a>
      </div>
      <Card className="mb-6" data-testid="rep-summary" data-claude={run.byClaude}>
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{d.title} <Badge variant="secondary">{d.from} – {d.to}</Badge>{run.byClaude ? <Badge variant="success">Summary by Claude</Badge> : <Badge variant="outline">FIRINGI summary</Badge>}</CardTitle>
          <CardDescription>Made {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}{run.emailedAt ? ` · emailed to ${run.recipients} admin${run.recipients === 1 ? "" : "s"}` : ""}</CardDescription></CardHeader>
        <CardContent><p className="whitespace-pre-line text-sm leading-relaxed">{run.summary}</p>
          {run.byClaude && d.highlights.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" data-testid="rep-highlights">{d.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>}</CardContent>
      </Card>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="rep-kpis">
        {d.kpis.map((k) => {
          const ch = k.prev ? Math.round(((k.value - k.prev) / Math.abs(k.prev)) * 100) : null;
          return <div key={k.label} className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k.label}</p><p className="text-lg font-semibold tabular-nums">{fmt(k.value, k.fmt)}</p>{ch !== null && <p className={`text-xs tabular-nums ${ch >= 0 ? "text-success" : "text-destructive"}`}>{ch >= 0 ? "+" : ""}{ch}% vs before</p>}</div>;
        })}
      </div>
      {d.tables.map((t) => (
        <Card key={t.title} className="mb-6"><CardHeader><CardTitle>{t.title}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto"><Table data-testid="rep-table"><THead><TR>{t.columns.map((c, i) => <TH key={c} className={i ? "text-right" : ""}>{c}</TH>)}</TR></THead>
            <TBody>{t.rows.map((r, j) => <TR key={j}>{r.map((v, i) => <TD key={i} className={i ? "text-right tabular-nums" : "max-w-xl break-words"}>{typeof v === "number" && t.columns[i]?.includes("€") ? eur(v) : String(v)}</TD>)}</TR>)}
              {!t.rows.length && <EmptyRow colSpan={t.columns.length}>Nothing in this period.</EmptyRow>}</TBody></Table></CardContent></Card>
      ))}
      <Card><CardHeader><CardTitle>Earlier {REPORT_LABEL[tab].toLowerCase()} reports</CardTitle></CardHeader>
        <CardContent><ul className="space-y-1 text-sm" data-testid="rep-history">{history.map((h) => <li key={h.id}><Link href={`/admin/ai/reports?tab=${tab}&run=${h.id}`} className={`underline-offset-4 hover:underline ${h.id === run!.id ? "font-semibold" : ""}`}>{h.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Link> <span className="text-xs text-muted-foreground">· {h.periodFrom.toISOString().slice(0, 10)} – {h.periodTo.toISOString().slice(0, 10)}{h.byClaude ? " · Claude" : ""}{h.emailedAt ? " · emailed" : ""}</span></li>)}</ul></CardContent></Card>
    </>
  );
}
