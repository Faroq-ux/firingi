import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { companyOverview } from "@/server/data/dashboard";
import { PageHeader } from "./page-header";
import { AccountStatusBadge } from "./status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

/** Small dashboard for vendor and buyer portals (only the company's own data). */
export async function CompanyDashboard({ ctx, portal }: { ctx: Ctx; portal: "vendor" | "buy" }) {
  const [o, t, tc, c, locale] = await Promise.all([companyOverview(ctx), getTranslations("dashboard"), getTranslations("companyType"), getTranslations("common"), getLocale()]);
  return (
    <>
      <PageHeader title={t("welcome", { name: ctx.user.name })} description={`${o.company.tradeName ?? o.company.legalName} · ${tc(ctx.company.type)}`} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>{t("companyFacts")}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("companyFacts")}</dt><dd className="font-medium">{o.company.country.flag} {o.company.legalName}</dd>
              <dt className="text-muted-foreground">{t("taxId")}</dt><dd>{o.company.taxId}</dd>
              <dt className="text-muted-foreground">{t("vat")}</dt><dd>{o.company.vatNumber ?? "—"}</dd>
              <dt className="text-muted-foreground">{c("status")}</dt><dd><AccountStatusBadge status={ctx.company.status} /></dd>
              <dt className="text-muted-foreground">{t("approvedOn")}</dt><dd>{formatDate(o.company.approvedAt, locale)}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("teamMembers")}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p className="text-3xl font-semibold tabular-nums">{o.members}</p>
            <p className="text-sm text-muted-foreground">{t("customRoles")}: {o.customRoles}</p>
            <Link href={`/${portal}/company/users`} className="text-sm text-primary hover:underline">→ {t("teamMembers")}</Link>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>{t("nextUp")}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{portal === "vendor" ? t("vendorNext") : t("buyerNext")}</CardContent>
      </Card>
    </>
  );
}
