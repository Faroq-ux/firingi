/** Reusable admin list of companies (vendors / customers) with search, status and country filters. */
import Link from "next/link";
import type { AccountStatus, CompanyType } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { listCompanies } from "@/server/data/companies";
import { PageHeader } from "@/components/layout/page-header";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { isIndividualPtNif } from "@/lib/tax-id";

const STATUSES: AccountStatus[] = ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"];

export async function CompanyList({
  ctx, title, description, basePath, types, defaultStatuses, params, columns = [],
}: {
  ctx: Ctx; title: string; description?: string; basePath: string; types: CompanyType[]; defaultStatuses?: AccountStatus[];
  params: { q?: string; status?: string; country?: string; page?: string };
  columns?: ("commission" | "vies" | "businessType" | "type")[];
}) {
  const statuses = params.status ? (params.status.split(",") as AccountStatus[]).filter((s) => STATUSES.includes(s)) : defaultStatuses;
  const [data, tc, tb, c, locale] = await Promise.all([
    listCompanies(ctx, { types, statuses, countryCode: params.country || undefined, q: params.q || undefined, page: Number(params.page) || 1 }),
    getTranslations("companyType"), getTranslations("onboarding.businessTypes"), getTranslations("common"), getLocale(),
  ]);
  const qs = (page: number) => `${basePath}?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.status ? { status: params.status } : {}), ...(params.country ? { country: params.country } : {}), page: String(page) })}`;

  return (
    <>
      <PageHeader title={title} description={description} />
      <form className="mb-4 flex flex-wrap gap-2" action={basePath}>
        <Input name="q" placeholder="Name, NIF or e-mail" defaultValue={params.q} className="w-64" />
        <Select name="status" defaultValue={params.status ?? ""} className="w-48">
          <option value="">{defaultStatuses ? "Default view" : "All statuses"}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
        </Select>
        <Input name="country" placeholder="Country (PT, ES…)" defaultValue={params.country} className="w-40" maxLength={2} />
        <Button type="submit" variant="outline">{c("filter")}</Button>
      </form>
      <Table>
        <THead>
          <TR>
            <TH>Company</TH>
            {columns.includes("type") && <TH>Type</TH>}
            <TH>Country / city</TH>
            {columns.includes("businessType") && <TH>Business</TH>}
            {columns.includes("vies") && <TH>VAT / VIES</TH>}
            {columns.includes("commission") && <TH>Commission</TH>}
            <TH>Docs to review</TH>
            <TH>Status</TH>
            <TH>Updated</TH>
          </TR>
        </THead>
        <TBody>
          {data.rows.length === 0 && <EmptyRow colSpan={9}>{c("noData")}</EmptyRow>}
          {data.rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/admin/companies/${r.id}`} className="font-medium text-primary hover:underline">{r.legalName}</Link>
                <div className="text-xs text-muted-foreground">NIF {r.taxId}{r.tradeName ? ` · ${r.tradeName}` : ""} {r.country.code === "PT" && isIndividualPtNif(r.taxId) && <Badge variant="warning">sole trader</Badge>}</div>
              </TD>
              {columns.includes("type") && <TD>{tc(r.type)}</TD>}
              <TD>{r.country.flag} {r.country.code} <span className="text-muted-foreground">{r.addresses[0]?.cityName}</span></TD>
              {columns.includes("businessType") && <TD>{r.businessType ? tb(r.businessType as "other") : "—"}</TD>}
              {columns.includes("vies") && (
                <TD className="text-xs">
                  {r.vatNumber ?? "—"}{" "}
                  {r.vatNumber && <Badge variant={r.vatValidations[0]?.result === "VALID" ? "success" : r.vatValidations[0] ? "destructive" : "secondary"}>{r.vatValidations[0]?.result ?? "not checked"}</Badge>}
                </TD>
              )}
              {columns.includes("commission") && <TD>{r.commissionRules[0] ? `${Number(r.commissionRules[0].rate)} %` : <Badge variant="warning">not set</Badge>}</TD>}
              <TD>{r._count.documents > 0 ? <Badge variant="warning">{r._count.documents}</Badge> : <span className="text-muted-foreground">0</span>}</TD>
              <TD><AccountStatusBadge status={r.status} /></TD>
              <TD className="text-xs text-muted-foreground">{formatDate(r.updatedAt, locale)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{c("pageOf", { page: data.page, count: data.pageCount })} · {data.total}</span>
        <div className="flex gap-2">
          {data.page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(data.page - 1)}>{c("previous")}</Link>}
          {data.page < data.pageCount && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(data.page + 1)}>{c("next")}</Link>}
        </div>
      </div>
    </>
  );
}
