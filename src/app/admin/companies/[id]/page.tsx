import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePortal } from "@/server/rbac/guard";
import { companyDetail } from "@/server/data/companies";
import { ADMIN_TRANSITIONS, describeMissing, isVendorType, REQUIRED_DOCUMENTS } from "@/server/onboarding/rules";
import { PageHeader } from "@/components/layout/page-header";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CommissionForm, CompanyStatusActions, DocumentReview, RestrictionReview, ViesPanel } from "@/components/admin/review-actions";
import { formatDate } from "@/lib/utils";
import { isIndividualPtNif } from "@/lib/tax-id";

export const metadata = { title: "Company" };

const DOC_VARIANT = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", EXPIRED: "destructive", REVOKED: "destructive" } as const;

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  const { company: c, actors, readiness, permissions: can } = await companyDetail(ctx, (await params).id);
  const [tc, td, tk, tb, locale] = await Promise.all([
    getTranslations("companyType"), getTranslations("onboarding.docTypes"), getTranslations("onboarding.addressKinds"), getTranslations("onboarding.businessTypes"), getLocale(),
  ]);
  const required = c.type !== "ADMIN" ? REQUIRED_DOCUMENTS[c.type] : [];
  const companyDocs = c.documents.filter((d) => !d.restrictionApprovalId);
  const lastVies = c.vatValidations[0];
  const currentCommission = c.commissionRules.find((r) => !r.validTo);
  const back = isVendorType(c.type) ? `/admin/vendors/${c.type === "DISTRIBUTOR" ? "distributors" : "wholesalers"}/all` : "/admin/customers/all";

  return (
    <>
      <PageHeader
        title={c.legalName}
        description={<span className="flex flex-wrap items-center gap-2">{c.country.flag} {tc(c.type)} · NIF {c.taxId}{c.tradeName ? ` · ${c.tradeName}` : ""} <AccountStatusBadge status={c.status} /></span>}
        actions={<Link href={back} className="text-sm text-primary hover:underline">← Back to list</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Decision</CardTitle><CardDescription>Current status: {c.status.replace("_", " ").toLowerCase()}{c.statusReason ? ` — ${c.statusReason}` : ""}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {c.country.code === "PT" && isIndividualPtNif(c.taxId) && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <b>Sole trader (individual NIF).</b> FIRINGI is B2B only — confirm an open business activity
                  (e.g. &quot;declaração de início de atividade&quot;) before approving.
                </div>
              )}
              {(c.status === "PENDING" || c.status === "UNDER_REVIEW") && (
                readiness.length ? (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p className="mb-1 font-medium">Before approval:</p>
                    <ul className="list-disc pl-5">{readiness.map((m, i) => <li key={i}>{describeMissing(m)}</li>)}</ul>
                  </div>
                ) : <p className="rounded-md bg-success/10 p-3 text-sm text-success">All approval requirements are met.</p>
              )}
              {can.decide ? (
                <CompanyStatusActions companyId={c.id} targets={ADMIN_TRANSITIONS[c.status]} approveBlocked={readiness.length > 0} />
              ) : <p className="text-sm text-muted-foreground">You can view this account but not decide on it.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Documents</CardTitle><CardDescription>Required: {required.map((r) => td(r)).join(", ")}</CardDescription></CardHeader>
            <CardContent>
              <ul className="divide-y rounded-lg border">
                {companyDocs.length === 0 && <li className="p-3 text-sm text-muted-foreground">No documents uploaded.</li>}
                {companyDocs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{td(d.type)} {required.includes(d.type) && <Badge variant="secondary">required</Badge>}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.fileName} · uploaded {formatDate(d.createdAt, locale, true)}{d.expiresAt ? ` · valid until ${formatDate(d.expiresAt, locale)}` : ""}
                        {d.reviewedById ? ` · reviewed by ${actors.get(d.reviewedById) ?? "—"}` : ""}
                      </div>
                      {d.reviewNote && <div className="text-xs text-destructive">Note: {d.reviewNote}</div>}
                    </div>
                    <Badge variant={DOC_VARIANT[d.status]}>{d.status}</Badge>
                    <a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>
                    {can.reviewDocs && <DocumentReview documentId={d.id} status={d.status} />}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Addresses</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {c.addresses.map((a) => (
                <div key={a.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-1.5"><span className="font-medium">{a.label}</span><Badge variant="secondary">{tk(a.kind)}</Badge>{a.isDefault && <Badge>default</Badge>}</div>
                  <p className="text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.postalCode} {a.cityName} {a.country.flag}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {c.restrictionApprovals.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Tobacco & alcohol access</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {c.restrictionApprovals.map((r) => (
                  <div key={r.id} className="space-y-2 rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.restriction}</span><Badge variant={DOC_VARIANT[r.status]}>{r.status}</Badge>
                      {r.validUntil && <span className="text-muted-foreground">until {formatDate(r.validUntil, locale)}</span>}
                    </div>
                    <pre className="rounded bg-muted p-2 text-xs">{JSON.stringify(r.extraInfo, null, 1)}</pre>
                    <div className="flex gap-2">{r.documents.map((d) => <a key={d.id} href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.fileName}</a>)}</div>
                    {can.restrictions && (r.status === "PENDING" || r.status === "APPROVED") && <RestrictionReview id={r.id} status={r.status} />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Company</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">E-mail</dt><dd className="break-all">{c.email}</dd>
                <dt className="text-muted-foreground">Phone</dt><dd>{c.phone ?? "—"}</dd>
                <dt className="text-muted-foreground">VAT</dt><dd>{c.vatNumber ?? "—"}</dd>
                {c.businessType && (<><dt className="text-muted-foreground">Business</dt><dd>{tb(c.businessType as "other")}</dd></>)}
                <dt className="text-muted-foreground">Registered</dt><dd>{formatDate(c.createdAt, locale)}</dd>
                <dt className="text-muted-foreground">Users</dt><dd className="min-w-0">{c.memberships.map((m) => <div key={m.id} className="break-all">{m.user.email}{m.isOwner ? " (owner)" : ""}</div>)}</dd>
              </dl>
            </CardContent>
          </Card>

          {c.vatNumber && (
            <Card>
              <CardHeader>
                <CardTitle>EU VAT (VIES)</CardTitle>
                <CardDescription>{c.type === "DISTRIBUTOR" ? "Required before approval (cross-border sales)." : "Optional for this account type."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {lastVies ? (
                  <div>
                    <Badge variant={lastVies.result === "VALID" ? "success" : "destructive"}>{lastVies.result}</Badge>{" "}
                    <span className="text-muted-foreground">{formatDate(lastVies.checkedAt, locale, true)} · {actors.get(lastVies.checkedById ?? "") ?? ""}</span>
                    {lastVies.registeredName && <p className="mt-1">{lastVies.registeredName}</p>}
                    {lastVies.consultationRef && <p className="mt-1 break-all text-xs text-muted-foreground">{lastVies.consultationRef}</p>}
                  </div>
                ) : <p className="text-muted-foreground">Not checked yet.</p>}
                <ViesPanel companyId={c.id} canManual={can.vatManual} />
              </CardContent>
            </Card>
          )}

          {isVendorType(c.type) && (
            <Card>
              <CardHeader><CardTitle>Commission</CardTitle><CardDescription>No default — must be set before the vendor goes live.</CardDescription></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>Current: {currentCommission ? <b>{Number(currentCommission.rate)} %</b> : <Badge variant="warning">not set</Badge>}</p>
                {can.commission && <CommissionForm companyId={c.id} current={currentCommission ? Number(currentCommission.rate) : null} />}
                {c.commissionRules.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {c.commissionRules.map((r) => (
                      <li key={r.id}>{Number(r.rate)} % · {formatDate(r.validFrom, locale)} → {r.validTo ? formatDate(r.validTo, locale) : "now"} · {actors.get(r.createdById ?? "") ?? ""}{r.note ? ` · ${r.note}` : ""}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs">
                {c.statusHistory.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{h.fromStatus ? `${h.fromStatus} → ` : ""}{h.toStatus}</span> · {formatDate(h.at, locale, true)}
                    <div className="text-muted-foreground">{actors.get(h.byUserId ?? "") ?? ""}{h.reason ? ` — ${h.reason}` : ""}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
