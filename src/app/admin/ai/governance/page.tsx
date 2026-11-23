import Link from "next/link";
import { Coins, Download, Gauge, Landmark, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tile } from "@/components/motion/dashboard-kit";
import { GovernanceForm } from "@/components/ai/ops";
import { AiSettingsForm } from "@/components/ai/actions";
import { aiPermissionMatrix, governance, governanceData, usageThisMonth } from "@/server/ai/ops/governance";
import { agentOptions, listApprovals } from "@/server/ai/ops/agents";
import { listActivity } from "@/server/ai/feed";
import { aiSettings, assistantStatus } from "@/server/ai/assistant";
import { can } from "@/server/rbac/guard";
import { AGENT_TOOLS, AUTONOMY, DATA_AREAS, tokenCost, type Autonomy, type DataArea } from "@/lib/ai-ops";
import { AI_MODEL_LABEL, type AiModel } from "@/lib/ai";
import { TabLinks, aiPage } from "../_kit";
import { Status, k, when } from "../_ops";

export const metadata = { title: "AI Governance" };
export const dynamic = "force-dynamic";
const TABS = ["OVERVIEW", "APPROVALS", "PERMISSIONS", "AUDIT", "MODELS"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { OVERVIEW: "Overview & switches", APPROVALS: "Approvals", PERMISSIONS: "Permissions", AUDIT: "Audit trail", MODELS: "Models & budget" };
const KINDS = ["ASSISTANT", "AGENT", "AGENT_ACTION", "APPROVED", "REJECTED", "AUTOMATION", "AUTOMATION_SETUP", "AGENT_SETUP", "GOVERNANCE", "SETTINGS", "REPORT", "REFRESH", "ACCEPT", "DISMISS", "BUDGET"] as const;
const RIGHTS = [["admin.ai.view", "Use the AI Centre"], ["admin.ai.automate", "Build automations"], ["admin.ai.agents", "Set up & run agents"], ["admin.ai.approve", "Approve AI actions"], ["admin.ai.govern", "AI Governance"]] as const;

export default async function GovernancePage({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string; page?: string; from?: string; to?: string; q?: string }> }) {
  const { ctx } = await aiPage();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "OVERVIEW";
  const canGovern = can(ctx, "admin.ai.govern");
  const [g, usage, ai, gd] = await Promise.all([governance(), usageThisMonth(), assistantStatus("STAFF"), governanceData(ctx)]);
  const pct = g.monthlyTokens ? Math.min(100, Math.round((usage.total / g.monthlyTokens) * 100)) : null;
  const cost = tokenCost(g, usage.tokensIn, usage.tokensOut);
  return (
    <>
      <PageHeader title="AI Governance" icon={Landmark}
        description="FIRINGI's rules for its AI: what may run, which model, how much it may spend, what needs a person's approval, what data it may see — and the audit trail of everything it did."
        actions={<Badge variant={g.enabled ? "success" : "destructive"} data-testid="gov-state">{g.enabled ? (ai.configured ? "AI on" : "AI on · Claude not connected") : "AI switched off"}</Badge>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="gov-kpis">
        <Tile icon={Gauge} label="Tokens this month" value={usage.total} locale="en" tone="tone-violet" i={0} hint={g.monthlyTokens ? `${pct}% of ${k(g.monthlyTokens)} budget` : "no monthly budget set"} testId="gov-usage" />
        <Tile icon={Coins} label="Estimated cost this month" value={cost ?? 0} fmt="money" locale="en" tone="tone-orange" i={1} hint={cost === null ? "set prices under Models & budget" : "from your € per million tokens"} />
        <Tile icon={ShieldCheck} label="AI actions waiting for approval" value={gd.pending} locale="en" tone="tone-teal" i={2} href="/admin/ai/automation?tab=APPROVALS" />
        <Tile icon={ShieldCheck} label="Agents that may act on their own" value={gd.autoAgents} locale="en" tone="tone-pink" i={3} href="/admin/ai/agents" hint={`allowed: ${g.autoActions.map((a) => AGENT_TOOLS[a]?.label).join(", ") || "nothing"}`} />
      </div>
      {pct !== null && <div className="mb-6" aria-label="Budget used"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${pct >= 100 ? "bg-destructive" : pct >= g.alertPct ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div></div>}
      <TabLinks testid="gov-tabs" active={tab} href={(x) => `/admin/ai/governance?tab=${x}`} tabs={TABS.map((x) => ({ key: x, label: LABEL[x] }))} />
      {!canGovern && tab !== "AUDIT" && tab !== "PERMISSIONS" && <p className="mb-4 text-sm text-muted-foreground">You can see these rules; changing them needs the AI Governance right.</p>}

      {tab === "OVERVIEW" && (
        <Card><CardHeader><CardTitle>Switches &amp; limits</CardTitle><CardDescription>The master switch stops every call to Claude immediately. Suggestions, forecasts and reports that don&apos;t use Claude keep working.</CardDescription></CardHeader>
          <CardContent><GovernanceForm value={g} canSave={canGovern} section="OVERVIEW" /></CardContent></Card>
      )}
      {tab === "APPROVALS" && <Approvals />}
      {tab === "PERMISSIONS" && <Permissions />}
      {tab === "AUDIT" && <Audit />}
      {tab === "MODELS" && <Models />}
    </>
  );

  async function Approvals() {
    const decided = (await listApprovals(ctx, "DECIDED")).slice(0, 50);
    const agents = await agentOptions(ctx);
    return (
      <div className="space-y-6">
        <Card><CardHeader><CardTitle>What needs a person</CardTitle><CardDescription>AI agents never change anything without a person unless they are set to act on their own and the action is allowed here. Automations can also stop for approval as a step.</CardDescription></CardHeader>
          <CardContent><GovernanceForm value={g} canSave={canGovern} section="APPROVALS" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Agents and how freely they act</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm" data-testid="gov-agents"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Agent</th><th>Acts</th><th>Acting tools</th><th>Active</th></tr></thead>
            <tbody>{agents.map((a) => <tr key={a.id} className="border-t"><td className="py-2"><Link className="hover:underline" href={`/admin/ai/agents/${a.id}`}>{a.name}</Link></td><td>{AUTONOMY[a.autonomy as Autonomy]?.label}</td><td>{a.tools.filter((t) => AGENT_TOOLS[t]?.kind === "ACT").map((t) => AGENT_TOOLS[t].label).join(", ") || "—"}</td><td>{a.active ? "yes" : "paused"}</td></tr>)}
              {!agents.length && <tr><td colSpan={4} className="py-2 text-muted-foreground">No agents yet.</td></tr>}</tbody></table>
        </CardContent></Card>
        <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-2"><CardTitle>Recent decisions</CardTitle><Link className="text-sm text-primary hover:underline" href="/admin/ai/automation?tab=APPROVALS">Approval queue →</Link></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="gov-decisions"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">When</th><th>What</th><th>From</th><th>Decision</th><th>By</th></tr></thead>
            <tbody>{decided.map((p) => <tr key={p.id} className="border-t"><td className="py-2 text-xs">{when(p.decidedAt ?? p.createdAt)}</td><td className="max-w-md break-words">{p.title}</td><td className="text-xs">{p.agent?.name ?? p.workflow?.name ?? p.source.toLowerCase()}</td><td><Status value={p.status} /></td><td className="text-xs">{p.decidedBy ?? "—"}</td></tr>)}
              {!decided.length && <tr><td colSpan={5} className="py-2 text-muted-foreground">Nothing decided yet.</td></tr>}</tbody></table>
        </CardContent></Card>
      </div>
    );
  }

  async function Permissions() {
    const [roles, agents, s] = await Promise.all([aiPermissionMatrix(), agentOptions(ctx), aiSettings()]);
    return (
      <div className="space-y-6">
        <Card><CardHeader className="flex-row flex-wrap items-center justify-between gap-2"><div><CardTitle>Who may do what with the AI</CardTitle><CardDescription>Rights come from staff roles. Super Admin holds them all.</CardDescription></div>
          {can(ctx, "admin.roles.manage") && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/admin/users/roles">Edit roles</Link>}</CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm" data-testid="gov-rights"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Role</th><th className="text-right">People</th>{RIGHTS.map(([c, l]) => <th key={c} className="px-2 text-center">{l}</th>)}</tr></thead>
              <tbody>{roles.map((r) => <tr key={r.id} className="border-t"><td className="py-2">{r.name}{r.system && <span className="ml-1 text-xs text-muted-foreground">(system)</span>}</td><td className="text-right tabular-nums">{r.people}</td>{RIGHTS.map(([c]) => <td key={c} className="px-2 text-center">{r.rights[c] ? "✓" : <span className="text-muted-foreground">—</span>}</td>)}</tr>)}</tbody></table>
          </CardContent></Card>
        <Card><CardHeader><CardTitle>What each agent may read</CardTitle><CardDescription>An agent&apos;s run reads with the rights of the person it runs for, narrowed to these areas.</CardDescription></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" data-testid="gov-agent-data"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Agent</th><th>Data</th><th>Tools</th></tr></thead>
            <tbody>{agents.map((a) => <tr key={a.id} className="border-t"><td className="py-2"><Link className="hover:underline" href={`/admin/ai/agents/${a.id}`}>{a.name}</Link></td><td>{a.dataAreas.map((d) => DATA_AREAS[d as DataArea]?.label).join(", ") || "only AI suggestions"}</td><td className="text-xs">{a.tools.map((t) => AGENT_TOOLS[t]?.label).join(", ")}</td></tr>)}
              {!agents.length && <tr><td colSpan={3} className="py-2 text-muted-foreground">No agents yet.</td></tr>}</tbody></table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Customers &amp; suppliers</CardTitle><CardDescription>The AI Assistant in the customer and supplier portals (each company can also be switched in Settings › Business Features).</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm" data-testid="gov-portals">
            <Badge variant={s.staff ? "success" : "secondary"}>FIRINGI staff: {s.staff ? "on" : "off"}</Badge><Badge variant={s.buyers ? "success" : "secondary"}>Customers: {s.buyers ? "on" : "off"}</Badge>
            <Badge variant={s.suppliers ? "success" : "secondary"}>Suppliers: {s.suppliers ? "on" : "off"}</Badge><Badge variant={s.photos ? "success" : "secondary"}>Photos &amp; scan: {s.photos ? "on" : "off"}</Badge>
            <Link className="text-primary hover:underline" href="/admin/ai/governance?tab=MODELS">Change →</Link>
          </CardContent></Card>
      </div>
    );
  }

  async function Audit() {
    const kind = KINDS.includes(sp.kind as (typeof KINDS)[number]) ? sp.kind : undefined;
    const from = sp.from ? new Date(`${sp.from}T00:00:00Z`) : null, to = sp.to ? new Date(new Date(`${sp.to}T00:00:00Z`).getTime() + 86400_000) : null;
    const log = await listActivity(ctx, { kind, page: Number(sp.page) || 1, from: from && !Number.isNaN(+from) ? from : null, to: to && !Number.isNaN(+to) ? to : null, q: sp.q?.slice(0, 80) || null });
    const qs = (p: Record<string, string | number | undefined>) => `?${new URLSearchParams(Object.entries({ tab: "AUDIT", kind, from: sp.from, to: sp.to, q: sp.q, ...p }).filter(([, v]) => v !== undefined && v !== "").map(([a, b]) => [a, String(b)]))}`;
    const csv = `/api/admin/ai/audit${qs({ tab: undefined, page: undefined }).replace("?tab=AUDIT&", "?").replace("?tab=AUDIT", "")}`;
    return (
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle>Audit trail</CardTitle><CardDescription>Everything the AI did and every change to how it works: who, when, which model, tokens.</CardDescription></div>
            <a className={buttonVariants({ variant: "outline", size: "sm" })} href={csv} data-testid="audit-csv"><Download className="size-4" /> CSV</a></div>
          <form className="flex flex-wrap items-end gap-2 text-sm" action="/admin/ai/governance">
            <input type="hidden" name="tab" value="AUDIT" />
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">What</span><select name="kind" defaultValue={kind ?? ""} className="h-9 rounded-md border bg-background px-2"><option value="">All</option>{KINDS.map((x) => <option key={x} value={x}>{x.toLowerCase().replace("_", " ")}</option>)}</select></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">From</span><input type="date" name="from" defaultValue={sp.from} className="h-9 rounded-md border bg-background px-2" /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">To</span><input type="date" name="to" defaultValue={sp.to} className="h-9 rounded-md border bg-background px-2" /></label>
            <label className="min-w-0 flex-1 basis-40 space-y-1"><span className="block text-xs text-muted-foreground">Contains</span><input name="q" defaultValue={sp.q} className="h-9 w-full rounded-md border bg-background px-2" /></label>
            <button className={buttonVariants({ size: "sm" })} type="submit">Filter</button>
          </form>
          <p className="text-xs text-muted-foreground">Last 30 days: {log.last30.events.toLocaleString("en")} events · {k(log.last30.tokensIn)} tokens in · {k(log.last30.tokensOut)} out</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="activity-log">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">When</th><th>What</th><th>Who</th><th>Summary</th><th>Model</th><th className="text-right">Tokens in / out</th></tr></thead>
            <tbody>{log.rows.map((r) => (
              <tr key={r.id} className="border-t align-top" data-testid="audit-row" data-kind={r.kind}>
                <td className="whitespace-nowrap py-2 text-xs tabular-nums">{when(r.at)}</td>
                <td><Badge variant={r.kind === "ASSISTANT" || r.kind === "AGENT" ? "default" : r.kind === "ACCEPT" || r.kind === "APPROVED" ? "success" : r.kind === "REJECTED" || r.kind === "GOVERNANCE" ? "warning" : "secondary"}>{r.kind.toLowerCase().replace("_", " ")}</Badge></td>
                <td className="text-sm">{r.actor}{r.company && <div className="text-xs text-muted-foreground">{r.company}</div>}</td>
                <td className="max-w-xl break-words">{r.summary}</td>
                <td className="text-xs">{r.model ?? "—"}</td>
                <td className="text-right text-xs tabular-nums">{r.tokensIn || r.tokensOut ? `${r.tokensIn.toLocaleString("en")} / ${r.tokensOut.toLocaleString("en")}` : "—"}</td>
              </tr>
            ))}{!log.rows.length && <tr><td colSpan={6} className="py-3 text-muted-foreground">Nothing found.</td></tr>}</tbody>
          </table>
          {log.pages > 1 && <div className="mt-3 flex gap-3 text-sm">{log.page > 1 && <Link href={qs({ page: log.page - 1 })}>← Newer</Link>}<span className="text-muted-foreground">Page {log.page} of {log.pages}</span>{log.page < log.pages && <Link href={qs({ page: log.page + 1 })}>Older →</Link>}</div>}
        </CardContent>
      </Card>
    );
  }

  async function Models() {
    const s = await aiSettings();
    const byModel = gd.byModel;
    return (
      <div className="space-y-6">
        <Card><CardHeader><CardTitle>Default model &amp; AI Assistant</CardTitle><CardDescription>The default model, who gets the Assistant, and the question limit.</CardDescription></CardHeader>
          <CardContent>{can(ctx, "admin.settings.manage") ? <AiSettingsForm settings={s} /> : <p className="text-sm">Default model: {AI_MODEL_LABEL[s.model]} · {s.hourlyLimit} questions per person per hour. Changing these needs the Settings right.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Model per feature, budget prices</CardTitle></CardHeader>
          <CardContent><GovernanceForm value={g} canSave={canGovern} section="MODELS" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Use by model, last 30 days</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm" data-testid="gov-by-model"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Model</th><th className="text-right">Calls</th><th className="text-right">Tokens in</th><th className="text-right">Tokens out</th><th className="text-right">Est. cost</th></tr></thead>
            <tbody>{byModel.map((m) => { const c = tokenCost(g, m.tokensIn, m.tokensOut); return <tr key={m.model} className="border-t"><td className="py-2">{AI_MODEL_LABEL[m.model as AiModel] ?? m.model}</td><td className="text-right tabular-nums">{m.calls}</td><td className="text-right tabular-nums">{k(m.tokensIn)}</td><td className="text-right tabular-nums">{k(m.tokensOut)}</td><td className="text-right tabular-nums">{c === null ? "—" : `€${c.toFixed(2)}`}</td></tr>; })}
              {!byModel.length && <tr><td colSpan={5} className="py-2 text-muted-foreground">No Claude calls in the last 30 days.</td></tr>}</tbody></table>
        </CardContent></Card>
      </div>
    );
  }
}
