/** Reusable admin list of companies (vendors / customers) with search, status and country filters. */
import Link from "next/link";
import type { AccountStatus, CompanyType } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { listCompanies } from "@/server/data/companies";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { listViews } from "@/server/services/workspace";
import { formatDate } from "@/lib/utils";
import { isIndividualPtNif } from "@/lib/tax-id";

const STATUSES: AccountStatus[] = ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"];
const STATUS_TONE: Record<string, Tone> = { PENDING: "secondary", UNDER_REVIEW: "warning", APPROVED: "success", REJECTED: "destructive", SUSPENDED: "destructive" };

export async function CompanyList({
  ctx, title, description, basePath, types, defaultStatuses, params, columns = [],
}: {
  ctx: Ctx; title: string; description?: string; basePath: string; types: CompanyType[]; defaultStatuses?: AccountStatus[];
  params: { q?: string; status?: string; country?: string; page?: string };
  columns?: ("commission" | "vies" | "businessType" | "type")[];
}) {
  const statuses = params.status ? (params.status.split(",") as AccountStatus[]).filter((s) => STATUSES.includes(s)) : defaultStatuses;
  const [data, tc, tb, c, locale] = await Promise.all([
    listCompanies(ctx, { types, statuses, countryCode: params.country || undefined, q: params.q || undefined, page: Number(params.page) || 1, pageSize: 300 }),
    getTranslations("companyType"), getTranslations("onboarding.businessTypes"), getTranslations("common"), getLocale(),
  ]);
  const views = await listViews(ctx, `admin.companies-${types.join("-").toLowerCase()}`);
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
      <DataTable tableId={`admin.companies-${types.join("-").toLowerCase()}`} views={views} empty={c("noData")} exportName={title.toLowerCase().replace(/\W+/g, "-")}
        columns={[
          { key: "company", label: "Company" }, ...(columns.includes("type") ? [{ key: "type", label: "Type", type: "badge" as const }] : []),
          { key: "taxId", label: "NIF", hidden: true }, { key: "country", label: "Country / city" },
          ...(columns.includes("businessType") ? [{ key: "business", label: "Business" }] : []),
          ...(columns.includes("vies") ? [{ key: "vies", label: "VAT / VIES", type: "badge" as const }] : []),
          ...(columns.includes("commission") ? [{ key: "commission", label: "Commission" }] : []),
          { key: "docs", label: "Docs to review", type: "number" as const }, { key: "status", label: "Status", type: "badge" as const }, { key: "updated", label: "Updated", type: "date" as const },
        ]}
        rows={data.rows.map((r) => ({
          id: r.id, href: `/admin/companies/${r.id}`,
          cells: {
            company: { t: r.legalName, sub: `NIF ${r.taxId}${r.tradeName ? ` · ${r.tradeName}` : ""}${r.country.code === "PT" && isIndividualPtNif(r.taxId) ? " · sole trader" : ""}` },
            type: { t: tc(r.type), tone: "secondary" as const }, taxId: r.taxId,
            country: `${r.country.flag} ${r.country.code} ${r.addresses[0]?.cityName ?? ""}`.trim(),
            business: r.businessType ? tb(r.businessType as "other") : "—",
            vies: r.vatNumber ? { t: `${r.vatNumber} · ${r.vatValidations[0]?.result ?? "not checked"}`, tone: r.vatValidations[0]?.result === "VALID" ? "success" as const : r.vatValidations[0] ? "destructive" as const : "secondary" as const } : "—",
            commission: r.commissionRules[0] ? { t: `${Number(r.commissionRules[0].rate)} %`, v: Number(r.commissionRules[0].rate) } : { t: "not set", tone: "warning" as const },
            docs: r._count.documents,
            status: { t: r.status.replace("_", " ").toLowerCase(), tone: STATUS_TONE[r.status] },
            updated: { t: formatDate(r.updatedAt, locale), v: r.updatedAt.getTime() },
          },
        }))} />
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
