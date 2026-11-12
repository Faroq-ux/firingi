import Link from "next/link";
import { AlertTriangle, BadgeCheck, CalendarClock, ClipboardCheck, Gauge, PauseCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canManageCompliance, complianceOverview } from "@/server/compliance/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { ProgressRing } from "@/components/motion/shapes";
import { RunCheck } from "@/components/compliance/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Compliance Dashboard" };
const B = "/admin/vendors/compliance";

export default async function ComplianceDashboard() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const d = await complianceOverview(ctx);
  const k = d.kpi;
  const today = new Date();
  return (
    <>
      <PageHeader title="Supplier Compliance" icon={ShieldCheck} description="Certificates FIRINGI asks distributors and wholesalers for: what's valid, expiring, waiting for review or due for a re-check — and which suppliers are paused because a required certificate is missing or expired." actions={canManageCompliance(ctx) ? <RunCheck /> : undefined} />
      <div className="mb-6 grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="glass-panel flex items-center gap-4 rounded-2xl border p-4" data-testid="compliant-ring">
          <ProgressRing value={k.compliantPct} label="Suppliers fully compliant" size={112}><span className="text-2xl font-bold tabular-nums">{k.compliantPct}%</span></ProgressRing>
          <div><p className="font-semibold">Fully compliant</p><p className="text-sm text-muted-foreground">{k.compliant} of {k.suppliers} live suppliers hold every required certificate.</p><p className="mt-1 text-xs text-muted-foreground">Average score {k.avgScore}/100</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile icon={ClipboardCheck} label="Waiting for review" value={k.pendingReview} locale="en" tone="tone-violet" i={0} href={`${B}/review`} testId="kpi-review" />
          <Tile icon={CalendarClock} label="Expiring in 30 days" value={k.expiring30} locale="en" tone="tone-orange" i={1} />
          <Tile icon={PauseCircle} label="Paused suppliers" value={k.paused} locale="en" tone="tone-pink" i={2} href={`${B}/suppliers`} testId="kpi-paused" />
          <Tile icon={RefreshCw} label="Re-checks due" value={k.rechecksDue} locale="en" tone="tone-blue" i={3} />
          <Tile icon={Gauge} label="Average score" value={k.avgScore} locale="en" tone="tone-teal" i={4} />
          <Tile icon={BadgeCheck} label="Badges switched on" value={d.types.filter((t) => t.badgeEnabled).length} locale="en" tone="tone-lime" i={5} href={`${B}/types`} />
        </div>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Coverage per certificate</CardTitle><CardDescription>Live suppliers it applies to that hold it (valid, in grace or with a waiver).</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-3" data-testid="coverage">
              {d.types.map((t, i) => {
                const pct = t.suppliers ? Math.round((100 * t.covered) / t.suppliers) : 0;
                return (
                  <li key={t.id} className="motion-rise" style={{ ["--i" as string]: i }}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5 font-medium">{t.name}{t.required && <Badge variant="destructive">required</Badge>}{t.badgeEnabled && <BadgeCheck className="size-4 text-[var(--vivid-teal)]" aria-label="badge on" />}</span>
                      <span className="tabular-nums text-muted-foreground">{t.covered}/{t.suppliers}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.name} coverage`}>
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-teal),var(--vivid-blue))] transition-[width] duration-700" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-destructive" />Paused suppliers</CardTitle><CardDescription>Customers don&apos;t see their offers until the certificate is approved or FIRINGI grants a grace period.</CardDescription></CardHeader>
          <CardContent>
            {d.paused.length === 0 ? <p className="text-sm text-muted-foreground">No supplier is paused.</p> : (
              <ul className="divide-y rounded-lg border" data-testid="paused-list">
                {d.paused.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <Link href={`${B}/suppliers/${s.id}`} className="font-medium text-primary hover:underline">{s.flag} {s.name}</Link>
                    <span className="text-muted-foreground">{s.pausedWhole ? "all offers" : `${s.pausedOffers} offers`}</span>
                    <span className="ml-auto flex flex-wrap gap-1">{s.missingRequired.map((m) => <Badge key={m} variant="destructive">{m}</Badge>)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Review queue</CardTitle><CardDescription>Oldest first. <Link href={`${B}/review`} className="text-primary hover:underline">Open all →</Link></CardDescription></CardHeader>
          <CardContent>
            {d.queue.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review.</p> : (
              <ul className="divide-y rounded-lg border">
                {d.queue.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <Link href={`${B}/certificates/${c.id}`} className="font-medium text-primary hover:underline">{c.type.name}</Link>
                    <span className="text-muted-foreground">{c.company.country.flag} {c.company.tradeName ?? c.company.legalName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(c.createdAt, "en", true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent decisions</CardTitle><CardDescription><Link href={`${B}/audit`} className="text-primary hover:underline">Full compliance audit →</Link></CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {d.recentAudit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs tabular-nums text-muted-foreground">{formatDate(a.at, "en", true)}</span>
                  <span className="font-medium">{a.action.replace(/^compliance\./, "").replace(/^company\.status\./, "").replace(/_/g, " ")}</span>
                  {a.certificate && <span>· {a.certificate}</span>}
                  {a.company && <span className="text-muted-foreground">· {a.company.name}</span>}
                  <span className="text-xs text-muted-foreground">· {a.actor?.name ?? "system"}</span>
                </li>
              ))}
              {d.recentAudit.length === 0 && <li className="text-muted-foreground">No compliance activity yet.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Expiring in the next 30 days</CardTitle></CardHeader>
          <CardContent>
            <DataTable tableId="admin.compliance.expiring" testId="expiring-table" empty="Nothing expires in the next 30 days."
              columns={[{ key: "supplier", label: "Supplier" }, { key: "cert", label: "Certificate", filter: true }, { key: "expires", label: "Expires", type: "date" }, { key: "days", label: "Days left", type: "number" }]}
              rows={d.expiringSoon.map((c) => ({ id: c.id, href: `${B}/certificates/${c.id}`, cells: { supplier: { t: c.company.tradeName ?? c.company.legalName, href: `${B}/suppliers/${c.company.id}` }, cert: { t: c.type.name, href: `${B}/certificates/${c.id}` }, expires: { t: formatDate(c.expiresOn, "en"), v: c.expiresOn!.getTime() }, days: Math.round((c.expiresOn!.getTime() - today.getTime()) / 86_400_000) } }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Re-checks (due or due within 30 days)</CardTitle><CardDescription>FIRINGI looks the certificate up with the issuer and marks it re-checked.</CardDescription></CardHeader>
          <CardContent>
            <DataTable tableId="admin.compliance.rechecks" testId="recheck-table" empty="No re-checks due."
              columns={[{ key: "supplier", label: "Supplier" }, { key: "cert", label: "Certificate", filter: true }, { key: "due", label: "Due", type: "date" }, { key: "state", label: "", type: "badge" }]}
              rows={d.rechecks.map((c) => ({ id: c.id, href: `${B}/certificates/${c.id}`, cells: { supplier: { t: c.company.tradeName ?? c.company.legalName, href: `${B}/suppliers/${c.company.id}` }, cert: { t: c.type.name, href: `${B}/certificates/${c.id}` }, due: { t: formatDate(c.recheckDueOn, "en"), v: c.recheckDueOn!.getTime() }, state: c.recheckDueOn! <= today ? { t: "Due", tone: "warning" } : { t: "Upcoming", tone: "outline" } } }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
