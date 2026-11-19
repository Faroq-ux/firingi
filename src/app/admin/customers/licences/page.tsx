import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { licenceCompanies, licenceRegister } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LicenceReview, RecordLicenceForm } from "@/components/excise/client";

export const metadata = { title: "Licences" };
export const dynamic = "force-dynamic";

const TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", EXPIRED: "destructive", REVOKED: "destructive" } as const;

export default async function LicenceRegisterPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.manage", "admin.vendors.view", "admin.vendors.approve"]);
  const sp = await searchParams;
  const r = await licenceRegister(ctx, { status: sp.status, q: sp.q });
  const manage = can(ctx, ["admin.customers.manage", "admin.vendors.approve"]);
  const companies = manage ? await licenceCompanies(ctx) : [];
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
  return (
    <>
      <PageHeader title="Licence Register" icon={BadgeCheck} description="Customers' alcohol, tobacco and vaping licences (review uploads, record ones seen on paper, revoke), and suppliers' excise authorisations." />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="licence-filters">
        {["", "PENDING", "APPROVED", "REJECTED", "EXPIRED", "REVOKED"].map((s) => <Link key={s} href={s ? `?status=${s}` : "?"} className={(sp.status ?? "") === s ? "font-semibold underline" : "text-primary hover:underline"}>{s ? s.toLowerCase() : "all"}{s === "PENDING" ? ` (${r.pending})` : ""}</Link>)}
        <form className="ml-auto"><input name="q" defaultValue={sp.q ?? ""} placeholder="Company or number" className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Search" /></form>
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Customers</CardTitle></CardHeader>
        <CardContent>
          {!r.customers.length ? <p className="py-4 text-center text-sm text-muted-foreground">No licences.</p> : (
            <ul className="divide-y" data-testid="licence-register">
              {r.customers.map((x) => (
                <li key={x.id} className="space-y-2 py-3 text-sm" data-testid="register-row" data-status={x.status} data-company={x.companyId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-64 break-words"><Link href={`/admin/companies/${x.companyId}`} className="font-medium text-primary hover:underline">{x.company}</Link> <span className="text-xs text-muted-foreground">· {x.taxId} · {x.country}</span><br /><span>{x.type}</span>{x.number ? <span className="font-mono text-xs"> · {x.number}</span> : null}<span className="text-xs text-muted-foreground">{x.issuer ? ` · ${x.issuer}` : ""} · until {day(x.expiresOn)}</span></span>
                    <Badge variant={x.superseded ? "outline" : TONE[x.status as keyof typeof TONE]}>{x.superseded ? "replaced" : x.status.toLowerCase()}</Badge>
                    {x.valid && x.daysLeft != null && x.daysLeft <= 30 && <Badge variant="warning">{x.daysLeft} days left</Badge>}
                    {x.hasFile && <a href={`/api/excise/licences/${x.id}`} className="text-xs text-primary hover:underline">file</a>}
                    <span className="text-xs text-muted-foreground">{x.reviewedBy ? `${x.reviewedBy} · ` : ""}{x.reviewedAt ? day(x.reviewedAt) : `uploaded ${day(x.createdAt)}`}</span>
                  </div>
                  {x.reviewNote && <p className="text-xs text-muted-foreground">{x.reviewNote}</p>}
                  {manage && !x.superseded && (x.status === "PENDING" || x.status === "APPROVED") && <LicenceReview id={x.id} status={x.status} expiresOn={x.expiresOn ? day(x.expiresOn) : null} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {manage && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Record a licence</CardTitle><CardDescription>Approved at once — for licences FIRINGI has seen.</CardDescription></CardHeader>
          <CardContent><RecordLicenceForm companies={companies} types={r.types} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Suppliers — excise authorisation</CardTitle><CardDescription>Reviewed in Vendors › Compliance (certificate &quot;excise-authorisation&quot;){r.settings.licences.supplier ? " — required: licensed offers are paused without it." : " — not required at the moment."}</CardDescription></CardHeader>
        <CardContent>
          {!r.suppliers.length ? <p className="py-2 text-sm text-muted-foreground">None uploaded.</p> : (
            <ul className="divide-y text-sm" data-testid="supplier-auth">
              {r.suppliers.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2"><Link href={`/admin/vendors/compliance/certificates/${c.id}`} className="min-w-0 flex-1 basis-56 font-medium text-primary hover:underline">{c.company}</Link><span className="font-mono text-xs">{c.number ?? "—"}</span><span className="text-xs text-muted-foreground">until {day(c.expiresOn)}</span><Badge variant={TONE[c.status as keyof typeof TONE] ?? "outline"}>{c.status.toLowerCase()}</Badge></li>)}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
