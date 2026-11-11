import Link from "next/link";
import { Activity, AlertTriangle, KeyRound, Radio, Webhook } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { integrationsOverview } from "@/server/integrations/admin";
import { IntegrationsHero } from "@/components/integrations/hero";
import { Tile } from "@/components/motion/dashboard-kit";
import { Sparkline, LiveDot } from "@/components/motion/shapes";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const o = await integrationsOverview(ctx);
  const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");
  const errRate = o.calls.last24h ? Math.round((o.calls.errors24h / o.calls.last24h) * 100) : 0;
  return (
    <>
      <IntegrationsHero title="Integrations" live="Live traffic" locale="en"
        subtitle="Every company's connections to FIRINGI: API keys, API traffic (v2), webhooks and scheduled price / stock feeds. Keys are issued by the companies themselves (Company › Integrations) or here under API keys."
        stats={[{ label: "Active keys", value: o.keys.active }, { label: "API calls · 24 h", value: o.calls.last24h }, { label: "Webhooks on", value: o.webhooks.active }, { label: "Feeds", value: o.feeds.length }]}>
        <Link href="/admin/settings/api" className="glass rounded-xl px-4 py-2 text-sm font-semibold text-white">API keys →</Link>
      </IntegrationsHero>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={KeyRound} label="Keys used today" value={o.keys.usedToday} locale="en" tone="tone-violet" i={0} hint={`${o.keys.selfService} created by companies`} />
        <Tile icon={Activity} label="API errors · 24 h" value={o.calls.errors24h} locale="en" tone={errRate > 10 ? "tone-pink" : "tone-teal"} i={1} hint={`${errRate} % of calls`}>
          <Sparkline values={o.calls.perDay} label="API calls per day, last 7 days" height={36} className="mt-1" />
        </Tile>
        <Tile icon={Webhook} label="Webhook deliveries waiting" value={o.webhooks.pending} locale="en" tone="tone-blue" i={2} hint={`${o.webhooks.failed24h} failed for good in 24 h`} />
        <Tile icon={AlertTriangle} label="Webhooks switched off" value={o.webhooks.off} locale="en" tone={o.webhooks.off ? "tone-orange" : "tone-lime"} i={3} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Activity className="size-4" aria-hidden />Busiest keys · 7 days</h2>
          {!o.topKeys.length ? <p className="text-sm text-muted-foreground">No API traffic yet.</p> : (
            <ul className="space-y-2">{o.topKeys.map((k, i) => { const max = o.topKeys[0].calls || 1; return (
              <li key={k.name} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{k.name}</span><span className="tabular-nums">{k.calls}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="motion-grow-x h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" style={{ width: `${(k.calls / max) * 100}%`, ["--i" as string]: i }} /></div></li>
            ); })}</ul>
          )}
        </section>
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Webhook className="size-4" aria-hidden />Webhooks needing attention</h2>
          {!o.webhooks.problems.length ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LiveDot />All webhooks delivering.</p> : (
            <ul className="divide-y text-sm">{o.webhooks.problems.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2"><Badge variant={p.active ? "warning" : "destructive"}>{p.active ? `${p.streak} failures` : "off"}</Badge><b>{p.company}</b><span className="min-w-0 flex-1 truncate font-mono text-xs">{p.url}</span><span className="text-xs text-muted-foreground">{p.reason ?? when(p.lastFailureAt)}</span></li>
            ))}</ul>
          )}
        </section>
        <section className="rounded-2xl border bg-card p-4 xl:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Radio className="size-4" aria-hidden />Scheduled feeds</h2>
          {!o.feeds.length ? <p className="text-sm text-muted-foreground">No supplier feeds yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-1">Supplier</th><th>Feed</th><th>Every</th><th>Last run</th><th>Result</th></tr></thead>
              <tbody>{o.feeds.map((f) => (
                <tr key={f.id} className="border-t"><td className="py-2">{f.company}</td><td>{f.name}{!f.enabled && <Badge variant="outline" className="ml-2">paused</Badge>}</td><td>{f.everyHours} h</td><td className="tabular-nums">{when(f.lastRunAt)}</td>
                  <td>{f.last ? <Badge variant={f.last.status === "APPLIED" ? "success" : f.last.status === "FAILED" ? "destructive" : "warning"}>{f.last.status === "PREVIEW" && f.last.heldReason ? "held" : f.last.status.toLowerCase()}</Badge> : "—"} <span className="text-xs text-muted-foreground">{f.last?.error ?? f.last?.heldReason ?? ""}</span></td></tr>
              ))}</tbody></table></div>
          )}
          {o.runs.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Imports this week: {o.runs.map((r) => `${r.count} ${r.source.toLowerCase()} ${r.status.toLowerCase()}`).join(" · ")}</p>}
        </section>
      </div>
    </>
  );
}
