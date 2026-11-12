import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BadgeCheck, ShieldCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierCompliance } from "@/server/compliance/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { ProgressRing } from "@/components/motion/shapes";
import { RevokeWaiver, WaiverForm } from "@/components/compliance/admin";
import { STATE_TONE, type CertStateKey } from "@/lib/compliance";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Supplier Compliance" };
const STATE_EN: Record<CertStateKey, string> = { VALID: "Valid", EXPIRING: "Expiring soon", WAIVED: "Grace period (FIRINGI)", GRACE: "Expired — in grace days", EXPIRED: "Expired", PENDING: "Waiting for review", REJECTED: "Rejected", MISSING: "Missing" };

export default async function SupplierCompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const d = await supplierCompliance(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const co = d.company;
  const paused = !!d.pausedWhole || d.pausedOffers > 0;
  return (
    <>
      <PageHeader title={`${co.country.flag ?? ""} ${co.tradeName ?? co.legalName}`} icon={ShieldCheck}
        description={<span className="flex flex-wrap items-center gap-2">{co.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler"} · {co.legalForm === "SOLE_TRADER" ? "sole trader" : "company"} · certificate code {co.registryCertificateCode ?? "—"} <Link href={`/admin/companies/${co.id}`} className="text-primary hover:underline">Company page →</Link></span>}
        actions={<Link href="/admin/vendors/compliance/suppliers" className="text-sm text-primary hover:underline">← All suppliers</Link>} />
      {paused && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm" role="alert" data-testid="admin-paused">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <p>{d.pausedWhole ? `All offers are paused (${d.pauseReason.join(", ")}) since ${formatDate(d.pausedWhole, "en", true)}.` : `${d.pausedOffers} offers are paused for missing category certificates.`} Customers can&apos;t see them until the certificate is approved or a grace period is granted.</p>
        </div>
      )}
      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_2fr]">
        <div className="glass-panel flex items-center gap-4 rounded-2xl border p-4">
          <ProgressRing value={d.score} label="Compliance score" size={112}><span className="text-2xl font-bold tabular-nums">{d.score}</span></ProgressRing>
          <div className="text-sm"><p className="font-semibold">Compliance score</p><p className="text-muted-foreground">{d.activeOffers} active offers{paused ? ` · ${d.pausedOffers} paused` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-1">{d.badges.map((b) => <Badge key={b.key} variant={b.hidden ? "outline" : "success"}><BadgeCheck className="mr-1 size-3" />{b.name}{b.hidden ? " (hidden)" : ""}</Badge>)}</div>
          </div>
        </div>
        <Card>
          <CardHeader><CardTitle>Checklist</CardTitle></CardHeader>
          <CardContent>
            <DataTable tableId="admin.compliance.checklist" testId="admin-checklist" empty="No certificate types apply to this supplier."
              columns={[{ key: "type", label: "Certificate" }, { key: "req", label: "", type: "badge" }, { key: "state", label: "State", type: "badge", filter: true }, { key: "detail", label: "Detail" }]}
              rows={d.rows.map((r) => {
                const cur = d.history.find((h) => h.id === (r.currentId ?? r.pendingId));
                return {
                  id: r.type.id, href: cur ? `/admin/vendors/compliance/certificates/${cur.id}` : undefined,
                  cells: {
                    type: { t: r.type.name, href: cur ? `/admin/vendors/compliance/certificates/${cur.id}` : undefined }, req: r.type.required ? { t: "required", tone: "destructive" } : { t: "optional", tone: "outline" },
                    state: { t: STATE_EN[r.state as CertStateKey], tone: STATE_TONE[r.state as CertStateKey] === "secondary" ? "outline" : STATE_TONE[r.state as CertStateKey] },
                    detail: [r.currentId && cur?.expiresOn ? `until ${formatDate(cur.expiresOn, "en")}` : null, r.graceUntil && r.state === "GRACE" ? `grace until ${formatDate(r.graceUntil, "en")}` : null, r.waiverUntil ? `waiver until ${formatDate(r.waiverUntil, "en")}` : null, r.pendingId ? "new upload to review" : null].filter(Boolean).join(" · ") || "—",
                  },
                };
              })} />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Grace periods</CardTitle><CardDescription>Let the supplier keep selling without a required certificate until a date (e.g. while a renewal audit is booked). Decisions are audited.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {d.waivers.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm">
                {d.waivers.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-2 p-2.5">
                    <span className="font-medium">{w.type.name}</span><span className="text-muted-foreground">until {formatDate(w.until, "en")}</span>
                    {w.revokedAt ? <Badge variant="outline">ended</Badge> : w.until < new Date(new Date().toISOString().slice(0, 10)) ? <Badge variant="outline">over</Badge> : <Badge variant="success">active</Badge>}
                    <span className="w-full text-xs text-muted-foreground">{w.reason}</span>
                    {d.canManage && !w.revokedAt && <RevokeWaiver id={w.id} />}
                  </li>
                ))}
              </ul>
            )}
            {d.canManage && <WaiverForm companyId={co.id} types={d.rows.map((r) => ({ id: r.type.id, label: `${r.type.name}${r.type.required ? " (required)" : ""}` }))} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>All uploads</CardTitle></CardHeader>
          <CardContent>
            <DataTable tableId="admin.compliance.uploads" testId="admin-uploads" empty="No certificates uploaded."
              columns={[{ key: "type", label: "Certificate", filter: true }, { key: "number", label: "Number" }, { key: "expires", label: "Valid until", type: "date" }, { key: "status", label: "Status", type: "badge", filter: true }]}
              rows={d.history.map((h) => ({ id: h.id, href: `/admin/vendors/compliance/certificates/${h.id}`, cells: { type: { t: h.typeName, href: `/admin/vendors/compliance/certificates/${h.id}`, sub: formatDate(h.createdAt, "en") }, number: h.number ?? "—", expires: { t: formatDate(h.expiresOn, "en"), v: h.expiresOn?.getTime() ?? 0 }, status: { t: h.supersededAt ? "superseded" : h.status.toLowerCase(), tone: h.supersededAt ? "outline" : h.status === "APPROVED" ? "success" : h.status === "PENDING" ? "warning" : "destructive" } } }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
