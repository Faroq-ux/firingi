import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { RunHealthChecks } from "@/components/admin/ops-controls";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { healthReport } from "@/server/ops/health";
import { listAlerts } from "@/server/ops/alerts";
import { errorGroups } from "@/server/ops/errors";

export const metadata = { title: "System Health" };
export const dynamic = "force-dynamic";
const TONE = { ok: "success", warning: "warning", critical: "destructive" } as const;
const ago = (d: Date | null | undefined) => {
  if (!d) return "—";
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 1 ? "just now" : m < 120 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [r, alerts, errors] = await Promise.all([healthReport(), listAlerts(30), errorGroups(24)]);
  return (
    <>
      <PageHeader title="System Health" description="FIRINGI checks itself every 5 minutes: database, file storage, scheduled jobs, backups, message and invoicing queues, errors, disk and database size, settings. Problems become alerts to super admins (e-mail, push, WhatsApp / SMS for critical ones); uptime monitors use /api/health."
        actions={can(ctx, "admin.settings.manage") ? <RunHealthChecks /> : null} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm" data-testid="overall">
        <Badge variant={TONE[r.status]} className="px-3 py-1 text-sm">{r.status === "ok" ? "All systems working" : r.status === "warning" ? "Needs attention" : "Critical problem"}</Badge>
        <span className="text-muted-foreground">Version {r.version.version} · build {r.version.commit} · running since {new Date(r.version.startedAt).toISOString().slice(0, 16).replace("T", " ")} UTC · checked {r.at.slice(11, 19)} UTC</span>
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Checks</CardTitle></CardHeader><CardContent>
          <Table data-testid="checks">
            <THead><TR><TH>Check</TH><TH>State</TH><TH>Detail</TH></TR></THead>
            <TBody>{r.checks.filter((c) => !c.key.startsWith("job:")).map((c) => <TR key={c.key}><TD className="font-medium">{c.label}</TD><TD><Badge variant={TONE[c.state]}>{c.state}</Badge></TD><TD className="text-sm">{c.detail}</TD></TR>)}</TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Alerts</CardTitle></CardHeader><CardContent>
          <Table data-testid="alerts">
            <THead><TR><TH>Alert</TH><TH>Since</TH><TH>State</TH></TR></THead>
            <TBody>
              {alerts.map((a) => <TR key={a.id}><TD><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">{a.detail}</div></TD><TD className="text-xs">{ago(a.openedAt)}</TD><TD>{a.resolvedAt ? <Badge variant="outline">resolved {ago(a.resolvedAt)}</Badge> : <Badge variant={a.severity === "CRITICAL" ? "destructive" : "warning"}>{a.severity.toLowerCase()}</Badge>}</TD></TR>)}
              {!alerts.length && <EmptyRow colSpan={3}>No alerts.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
      <Card className="mb-4"><CardHeader><CardTitle>Scheduled jobs</CardTitle></CardHeader><CardContent>
        <Table data-testid="jobs">
          <THead><TR><TH>Job</TH><TH>Schedule</TH><TH>Last run</TH><TH>Last success</TH><TH className="text-right">Took</TH><TH>State</TH></TR></THead>
          <TBody>{r.jobs.map((j) => (
            <TR key={j.key}>
              <TD className="font-medium">{j.label}<div className="font-mono text-xs font-normal text-muted-foreground">{j.path ?? "backup service"}</div></TD>
              <TD className="text-xs">{j.every}</TD>
              <TD className="text-xs">{ago(j.last?.startedAt)}{j.last?.ok === false && <div className="max-w-xs truncate text-destructive" title={j.last.error ?? ""}>{j.last.error?.split("\n")[0]}</div>}</TD>
              <TD className="text-xs">{ago(j.lastOk?.startedAt)}</TD>
              <TD className="text-right text-xs tabular-nums">{j.last?.durationMs != null ? `${(j.last.durationMs / 1000).toFixed(1)} s` : "—"}</TD>
              <TD><Badge variant={j.state === "ok" ? "success" : j.state === "never" ? "outline" : j.state === "last-failed" ? "warning" : j.critical ? "destructive" : "warning"}>{j.state.replace("-", " ")}</Badge></TD>
            </TR>
          ))}</TBody>
        </Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Errors, last 24 hours</CardTitle></CardHeader><CardContent>
        <Table data-testid="errors">
          <THead><TR><TH>Error</TH><TH>Where</TH><TH className="text-right">Times</TH><TH>Last</TH></TR></THead>
          <TBody>
            {errors.map((e) => <TR key={e.fingerprint}><TD className="max-w-xl"><Badge variant="secondary">{e.source}</Badge> <span className="text-sm">{e.message}</span></TD><TD className="font-mono text-xs">{e.path ?? "—"}</TD><TD className="text-right tabular-nums">{e.n}</TD><TD className="text-xs">{ago(e.last)}</TD></TR>)}
            {!errors.length && <EmptyRow colSpan={4}>No errors in the last 24 hours.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}
