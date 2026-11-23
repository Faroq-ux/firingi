import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { listAgents, mayManageAgents } from "@/server/ai/ops/agents";
import { governance } from "@/server/ai/ops/governance";
import { AGENT_TEMPLATES, AGENT_TOOLS, AUTONOMY, scheduleText, tokenCost, type Autonomy, type Schedule } from "@/lib/ai-ops";
import { TabLinks, aiPage } from "../_kit";
import { AgentIcon, k, secs, when } from "../_ops";

export const metadata = { title: "AI Agents" };
export const dynamic = "force-dynamic";
const TABS = ["AGENTS", "PERFORMANCE", "TEMPLATES"] as const;
type Tab = (typeof TABS)[number];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await aiPage();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "AGENTS";
  const [agents, g] = await Promise.all([listAgents(ctx), governance()]);
  const canEdit = mayManageAgents(ctx);
  const autoLabel = (a: string) => AUTONOMY[a as Autonomy]?.label ?? a;
  return (
    <>
      <PageHeader title="AI Agents" icon={Bot}
        description="Specialist AI agents FIRINGI's team sets up for its own workflow: each has a job, the tools and data it may use, how freely it may act, a model and a schedule. Agents read with the rights of the person they work for; their actions wait for approval unless AI Governance allows them."
        actions={canEdit ? <Link className={buttonVariants()} href="/admin/ai/agents/new" data-testid="ag-new"><Plus className="size-4" /> New agent</Link> : undefined} />
      {(!g.enabled || !g.agents) && <p className="mb-4 rounded-xl border border-amber-500/40 p-3 text-sm" data-testid="ag-off">AI agents are switched off in <Link className="underline" href="/admin/ai/governance">AI Governance</Link>.</p>}
      <TabLinks testid="ag-tabs" active={tab} href={(x) => `/admin/ai/agents?tab=${x}`} tabs={[{ key: "AGENTS", label: "Agents", count: agents.length }, { key: "PERFORMANCE", label: "Performance" }, { key: "TEMPLATES", label: "Templates" }]} />

      {tab === "AGENTS" && (!agents.length ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="ag-empty">No agents yet.{canEdit ? <> <Link className="underline" href="/admin/ai/agents?tab=TEMPLATES">Start from a template</Link> or create your own.</> : ""}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="ag-cards">
          {agents.map((a, i) => (
            <Link key={a.id} href={`/admin/ai/agents/${a.id}`} className="stat-card flex flex-col gap-3 rounded-2xl border bg-card p-4 hover:-translate-y-0.5" style={{ ["--i" as string]: i } as React.CSSProperties} data-testid="ag-card" data-name={a.name}>
              <div className="flex items-start gap-3">
                <AgentIcon icon={a.icon} tone={a.tone} />
                <div className="min-w-0 flex-1"><p className="break-words font-semibold">{a.name}</p><p className="break-words text-sm text-muted-foreground">{a.role}</p></div>
                <Badge variant={a.active ? "success" : "secondary"}>{a.active ? "active" : "paused"}</Badge>
              </div>
              <div className="flex flex-wrap gap-1 text-xs"><Badge variant="outline">{autoLabel(a.autonomy)}</Badge><Badge variant="outline">{a.tools.length} tools</Badge>{a.schedule ? <Badge variant="outline">{scheduleText(a.schedule as Schedule)}</Badge> : null}</div>
              <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                <div><dt className="text-muted-foreground">Runs (30 d)</dt><dd className="text-base font-semibold tabular-nums">{a.stats.runs}</dd></div>
                <div><dt className="text-muted-foreground">Success</dt><dd className="text-base font-semibold tabular-nums">{a.stats.successRate === null ? "—" : `${a.stats.successRate}%`}</dd></div>
                <div><dt className="text-muted-foreground">Approved</dt><dd className="text-base font-semibold tabular-nums">{a.stats.approvalRate === null ? "—" : `${a.stats.approvalRate}%`}</dd></div>
              </dl>
            </Link>
          ))}
        </div>
      ))}

      {tab === "PERFORMANCE" && (
        <Card><CardHeader><CardTitle>How the agents perform (last 30 days)</CardTitle><CardDescription>Success = runs that finished; approved = share of their proposals people approved; 👍/👎 = staff ratings of their reports.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm" data-testid="ag-perf">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Agent</th><th className="text-right">Runs</th><th className="text-right">Success</th><th className="text-right">Failed / blocked</th><th className="text-right">Avg time</th><th className="text-right">Proposals</th><th className="text-right">Approved</th><th className="text-right">👍 / 👎</th><th className="text-right">Tokens</th><th className="text-right">Est. cost</th><th>Last run</th></tr></thead>
              <tbody>{agents.map((a) => { const c = tokenCost(g, a.stats.tokensIn, a.stats.tokensOut); return (
                <tr key={a.id} className="border-t" data-testid="ag-perf-row">
                  <td className="py-2"><Link className="hover:underline" href={`/admin/ai/agents/${a.id}`}>{a.name}</Link></td>
                  <td className="text-right tabular-nums">{a.stats.runs}</td><td className="text-right tabular-nums">{a.stats.successRate === null ? "—" : `${a.stats.successRate}%`}</td>
                  <td className="text-right tabular-nums">{a.stats.failed} / {a.stats.blocked}</td><td className="text-right tabular-nums">{secs(a.stats.avgMs)}</td>
                  <td className="text-right tabular-nums">{a.stats.proposals}</td><td className="text-right tabular-nums">{a.stats.approvalRate === null ? "—" : `${a.stats.approvalRate}% (${a.stats.approved}/${a.stats.approved + a.stats.rejected})`}</td>
                  <td className="text-right tabular-nums">{a.stats.up} / {a.stats.down}</td><td className="text-right tabular-nums">{k(a.stats.tokens)}</td><td className="text-right tabular-nums">{c === null ? "—" : `€${c.toFixed(2)}`}</td><td className="text-xs">{when(a.stats.lastRun)}</td>
                </tr>
              ); })}{!agents.length && <tr><td colSpan={11} className="py-2 text-muted-foreground">No agents yet.</td></tr>}</tbody>
            </table>
          </CardContent></Card>
      )}

      {tab === "TEMPLATES" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="ag-templates">
          {AGENT_TEMPLATES.map((t) => (
            <div key={t.key} className="flex flex-col gap-3 rounded-2xl border bg-card p-4" data-testid="ag-template" data-key={t.key}>
              <div className="flex items-start gap-3"><AgentIcon icon={t.icon} tone={t.tone} /><div className="min-w-0"><p className="font-semibold">{t.name}</p><p className="text-sm text-muted-foreground">{t.role}</p></div></div>
              <p className="flex-1 text-xs text-muted-foreground">{t.tools.map((x) => AGENT_TOOLS[x].label).join(" · ")}</p>
              <div className="flex flex-wrap gap-1 text-xs"><Badge variant="outline">{autoLabel(t.autonomy)}</Badge>{t.schedule && <Badge variant="outline">{scheduleText(t.schedule)}</Badge>}</div>
              {canEdit && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/admin/ai/agents/new?template=${t.key}`} data-testid="ag-use-template">Use this template</Link>}
            </div>
          ))}
          <div className="flex flex-col justify-center gap-2 rounded-2xl border border-dashed p-4 text-sm">
            <p className="font-medium">Your own agent</p><p className="text-muted-foreground">Any job: write its instructions, pick its tools and data, and decide how freely it acts.</p>
            {canEdit && <Link className={buttonVariants({ size: "sm" })} href="/admin/ai/agents/new">Create from scratch</Link>}
          </div>
        </div>
      )}
    </>
  );
}
