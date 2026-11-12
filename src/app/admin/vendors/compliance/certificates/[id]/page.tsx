import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { certificateDetail } from "@/server/compliance/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CertificateActions, ReviewCertificate } from "@/components/compliance/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Certificate" };
const TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", EXPIRED: "destructive", REVOKED: "destructive" } as const;

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const d = await certificateDetail(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const c = d.cert;
  const supplier = c.company.tradeName ?? c.company.legalName;
  const recheckDefault = c.type.recheckMonths ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + c.type.recheckMonths, new Date().getUTCDate())).toISOString().slice(0, 10) : null;
  const file = `/api/compliance/certificates/${c.id}`;
  return (
    <>
      <PageHeader title={`${c.type.name} — ${supplier}`} icon={FileCheck2}
        description={<span className="flex flex-wrap items-center gap-2"><Badge variant={TONE[c.status]}>{c.supersededAt ? "SUPERSEDED" : c.status}</Badge>{c.type.required && <Badge variant="destructive">required</Badge>}{c.badgeHidden && <Badge variant="outline">badge hidden</Badge>}<Link href={`/admin/vendors/compliance/suppliers/${c.companyId}`} className="text-primary hover:underline">Supplier compliance →</Link></span>}
        actions={<Link href="/admin/vendors/compliance/review" className="text-sm text-primary hover:underline">← Review queue</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>File</CardTitle><CardDescription>{c.fileName} · {(c.sizeBytes / 1024).toFixed(0)} KB · <a href={file} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open in a new tab</a></CardDescription></CardHeader>
          <CardContent>
            {c.mimeType === "application/pdf"
              ? <iframe src={file} title={c.fileName} className="h-[32rem] w-full rounded-lg border bg-white" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={file} alt={c.fileName} className="max-h-[32rem] w-full rounded-lg border object-contain" />}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Number</dt><dd>{c.number ?? "—"}</dd>
                <dt className="text-muted-foreground">Issuer</dt><dd>{c.issuer ?? "—"}</dd>
                <dt className="text-muted-foreground">Issued</dt><dd>{formatDate(c.issuedOn, "en")}</dd>
                <dt className="text-muted-foreground">Valid until</dt><dd>{c.type.hasExpiry ? formatDate(c.expiresOn, "en") : "no expiry"}</dd>
                <dt className="text-muted-foreground">Next re-check</dt><dd>{formatDate(c.recheckDueOn, "en")}</dd>
                <dt className="text-muted-foreground">Last checked</dt><dd>{formatDate(c.lastCheckAt, "en", true)}</dd>
                <dt className="text-muted-foreground">Uploaded</dt><dd>{formatDate(c.createdAt, "en", true)}</dd>
                {c.reviewNote && (<><dt className="text-muted-foreground">Note</dt><dd>{c.reviewNote}</dd></>)}
              </dl>
            </CardContent>
          </Card>
          {d.canManage && (
            <Card>
              <CardHeader><CardTitle>Decision</CardTitle><CardDescription>{c.status === "PENDING" ? "Check the file against the details. Approving replaces the supplier's earlier certificate of this type and re-applies the pause rules." : "Actions on this certificate."}</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <ReviewCertificate id={c.id} status={c.status} expiresOn={c.expiresOn?.toISOString() ?? null} number={c.number} hasExpiry={c.type.hasExpiry} needsNumber={c.type.needsNumber} recheckDefault={recheckDefault} />
                {!c.supersededAt && <CertificateActions id={c.id} status={c.status} badgeHidden={c.badgeHidden} badgeEnabled={c.type.badgeEnabled} />}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Versions of this certificate</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y rounded-lg border text-sm">
                {d.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 p-2.5">
                    {h.id === c.id ? <span className="font-medium">This one</span> : <Link href={`/admin/vendors/compliance/certificates/${h.id}`} className="text-primary hover:underline">{h.fileName}</Link>}
                    <Badge variant={h.supersededAt ? "outline" : TONE[h.status]}>{h.supersededAt ? "superseded" : h.status.toLowerCase()}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(h.createdAt, "en")}{h.expiresOn ? ` → ${formatDate(h.expiresOn, "en")}` : ""}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Audit</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm" data-testid="cert-audit">
                {d.audit.map((a) => <li key={a.id}><span className="text-xs tabular-nums text-muted-foreground">{formatDate(a.at, "en", true)}</span> · <span className="font-medium">{a.action.replace("compliance.", "").replace(/_/g, " ")}</span> · <span className="text-muted-foreground">{a.actor?.name ?? "system"}</span></li>)}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
