/** Review queues: documents, tobacco/alcohol access, drivers, customer addresses, vendor compliance. */
import Link from "next/link";
import type { CompanyType } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { customerAddresses, documentQueue, restrictionQueue, vendorCompliance } from "@/server/data/companies";
import { listDriverApplications } from "@/server/services/drivers";
import { REQUIRED_DRIVER_DOCUMENTS } from "@/server/onboarding/rules";
import { PageHeader } from "@/components/layout/page-header";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DocumentReview, DriverReview, RestrictionReview } from "./review-actions";
import { formatDate } from "@/lib/utils";

export async function DocumentQueue({ ctx, title, types }: { ctx: Ctx; title: string; types: CompanyType[] }) {
  const [rows, td, tc, locale] = await Promise.all([documentQueue(ctx, { types }), getTranslations("onboarding.docTypes"), getTranslations("companyType"), getLocale()]);
  return (
    <>
      <PageHeader title={title} description="Documents waiting for review, oldest first." />
      <Table>
        <THead><TR><TH>Company</TH><TH>Document</TH><TH>Uploaded</TH><TH>File</TH><TH className="text-right">Decision</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>Nothing to review.</EmptyRow>}
          {rows.map((d) => (
            <TR key={d.id}>
              <TD><Link href={`/admin/companies/${d.company!.id}`} className="font-medium text-primary hover:underline">{d.company!.country.flag} {d.company!.legalName}</Link><div className="text-xs text-muted-foreground">{tc(d.company!.type)}</div></TD>
              <TD>{td(d.type)}</TD>
              <TD className="text-xs text-muted-foreground">{formatDate(d.createdAt, locale, true)}</TD>
              <TD><a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.fileName}</a></TD>
              <TD>{d.canReview ? <DocumentReview documentId={d.id} status={d.status} /> : <span className="text-xs text-muted-foreground">view only</span>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function RestrictionQueue({ ctx, title }: { ctx: Ctx; title: string }) {
  const [rows, locale] = await Promise.all([restrictionQueue(ctx, ["PENDING", "APPROVED"]), getLocale()]);
  const canDecide = can(ctx, ["admin.customers.approve", "admin.risk.manage"]);
  return (
    <>
      <PageHeader title={title} description="Tobacco and alcohol access requests. Restricted products are only visible to buyers with an approved, valid licence." />
      <Table>
        <THead><TR><TH>Company</TH><TH>Category</TH><TH>Licence</TH><TH>Status</TH><TH className="w-[28rem]">Decision</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No requests.</EmptyRow>}
          {rows.map((r) => {
            const info = (r.extraInfo ?? {}) as { licenceNumber?: string; issuingAuthority?: string };
            return (
              <TR key={r.id} className="align-top">
                <TD><Link href={`/admin/companies/${r.company.id}`} className="font-medium text-primary hover:underline">{r.company.country.flag} {r.company.legalName}</Link></TD>
                <TD><Badge variant="secondary">{r.restriction}</Badge></TD>
                <TD className="text-xs">{info.licenceNumber} · {info.issuingAuthority}<div>{r.documents.map((d) => <a key={d.id} href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.fileName}</a>)}</div></TD>
                <TD><Badge variant={r.status === "APPROVED" ? "success" : "warning"}>{r.status}</Badge>{r.validUntil && <div className="text-xs text-muted-foreground">until {formatDate(r.validUntil, locale)}</div>}</TD>
                <TD>{canDecide ? <RestrictionReview id={r.id} status={r.status} /> : <span className="text-xs text-muted-foreground">view only</span>}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}

export async function DriverApplications({ ctx, title, documentsOnly = false }: { ctx: Ctx; title: string; documentsOnly?: boolean }) {
  const [rows, td, locale] = await Promise.all([listDriverApplications(ctx, { pendingOnly: false }), getTranslations("onboarding.docTypes"), getLocale()]);
  const manage = can(ctx, "admin.fleet.manage");
  return (
    <>
      <PageHeader title={title} description={documentsOnly ? "Driver identity and licence documents." : "Driver applications. Required documents: ID and driving licence, both approved."} />
      <Table>
        <THead><TR><TH>Driver</TH><TH>Fleet</TH><TH>Licence</TH><TH>Documents</TH><TH>Status</TH>{!documentsOnly && <TH className="text-right">Decision</TH>}</TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={6}>No drivers.</EmptyRow>}
          {rows.map((d) => (
            <TR key={d.id} className="align-top">
              <TD><div className="font-medium">{d.user.name}</div><div className="text-xs text-muted-foreground">{d.user.email} · {d.user.phone ?? ""}</div></TD>
              <TD className="text-xs">{d.owner.type === "ADMIN" ? "FIRINGI" : d.owner.legalName}</TD>
              <TD className="text-xs">{d.licenceNumber}{d.licenceExpiry ? ` · ${formatDate(d.licenceExpiry, locale)}` : ""}</TD>
              <TD>
                <ul className="space-y-1.5">
                  {d.documents.length === 0 && <li className="text-xs text-muted-foreground">None — needs {REQUIRED_DRIVER_DOCUMENTS.map((x) => td(x)).join(", ")}</li>}
                  {d.documents.map((doc) => (
                    <li key={doc.id} className="text-xs">
                      <a href={`/api/files/${doc.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{td(doc.type)}</a>{" "}
                      <Badge variant={doc.status === "APPROVED" ? "success" : doc.status === "PENDING" ? "warning" : "destructive"}>{doc.status}</Badge>
                      {manage && <div className="mt-1"><DocumentReview documentId={doc.id} status={doc.status} /></div>}
                    </li>
                  ))}
                </ul>
              </TD>
              <TD><AccountStatusBadge status={d.status} /></TD>
              {!documentsOnly && <TD>{manage ? <DriverReview driverId={d.id} status={d.status} /> : null}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function CustomerAddressList({ ctx }: { ctx: Ctx }) {
  const [rows, tk] = await Promise.all([customerAddresses(ctx), getTranslations("onboarding.addressKinds")]);
  return (
    <>
      <PageHeader title="Customer Addresses" description="All active addresses of wholesale customers." />
      <Table>
        <THead><TR><TH>Customer</TH><TH>Type</TH><TH>Name</TH><TH>Address</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={4}>No addresses.</EmptyRow>}
          {rows.map((a) => (
            <TR key={a.id}>
              <TD><Link href={`/admin/companies/${a.company.id}`} className="text-primary hover:underline">{a.company.legalName}</Link></TD>
              <TD><Badge variant="secondary">{tk(a.kind)}</Badge>{a.isDefault && <Badge className="ml-1">default</Badge>}</TD>
              <TD>{a.label}</TD>
              <TD className="text-sm text-muted-foreground">{a.line1}, {a.postalCode} {a.cityName} {a.country.flag}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function VendorComplianceList({ ctx }: { ctx: Ctx }) {
  const [rows, tc] = await Promise.all([vendorCompliance(ctx), getTranslations("companyType")]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Vendor Compliance" description="VAT (VIES) status, document status and commission per vendor." />
      <Table>
        <THead><TR><TH>Vendor</TH><TH>Type</TH><TH>VAT / VIES</TH><TH>Documents</TH><TH>Commission</TH><TH>Status</TH></TR></THead>
        <TBody>
          {rows.map((v) => {
            const approved = v.documents.filter((d) => d.status === "APPROVED").length;
            const expired = v.documents.filter((d) => d.expiresAt && d.expiresAt < now).length;
            return (
              <TR key={v.id}>
                <TD><Link href={`/admin/companies/${v.id}`} className="font-medium text-primary hover:underline">{v.country.flag} {v.legalName}</Link></TD>
                <TD>{tc(v.type)}</TD>
                <TD className="text-xs">{v.vatNumber ?? "—"} {v.vatNumber && <Badge variant={v.vatValidations[0]?.result === "VALID" ? "success" : "warning"}>{v.vatValidations[0]?.result ?? "not checked"}</Badge>}</TD>
                <TD className="text-xs">{approved}/{v.documents.length} approved{expired ? <Badge variant="destructive" className="ml-1">{expired} expired</Badge> : null}</TD>
                <TD>{v.commissionRules[0] ? `${Number(v.commissionRules[0].rate)} %` : <Badge variant="warning">not set</Badge>}</TD>
                <TD><AccountStatusBadge status={v.status} /></TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
