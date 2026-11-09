import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, Building2, Clock, Globe, Package, Store, Truck, Users, Wallet } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview } from "@/server/data/dashboard";
import { PageHeader } from "@/components/layout/page-header";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Executive Overview" };

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.dashboard.view");
  const [o, t, tc, locale] = await Promise.all([adminOverview(ctx), getTranslations("dashboard"), getTranslations("companyType"), getLocale()]);

  return (
    <>
      <PageHeader title={t("welcome", { name: ctx.user.name })} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/dashboard/today"><Stat icon={Package} label={t("ordersToday")} value={o.orders.today} /></Link>
        <Link href="/admin/orders/pending-confirmation"><Stat icon={Clock} label={t("awaitingConfirmation")} value={o.orders.awaiting} /></Link>
        <Link href="/admin/dashboard/alerts"><Stat icon={AlertTriangle} label={t("openExceptions")} value={o.orders.exceptions} /></Link>
        <Stat icon={Wallet} label={t("monthSales")} value={o.orders.monthCount} hint={`${formatMoney(o.orders.monthNet, locale)} · ${t("margin")} ${formatMoney(o.orders.monthMargin, locale)}`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat icon={Truck} label={t("distributors")} value={o.distributors.total} hint={t("activeOf", o.distributors)} />
        <Stat icon={Store} label={t("wholesalers")} value={o.wholesalers.total} hint={t("activeOf", o.wholesalers)} />
        <Stat icon={Building2} label={t("customers")} value={o.customers.total} hint={t("activeOf", o.customers)} />
        <Stat icon={Users} label={t("users")} value={o.activeUsers} />
        <Stat icon={Globe} label={t("markets")} value={o.customerMarkets} />
        <Stat icon={Globe} label={t("sourcing")} value={o.sourcingCountries} />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("recent")}</CardTitle>
          <CardDescription>
            <Link className="text-primary hover:underline" href="/admin/vendors/distributors/applications">→ {t("applications")}</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>{t("colCompany")}</TH><TH>{t("colType")}</TH><TH>{t("colCountry")}</TH><TH>{t("colStatus")}</TH><TH>{t("colRegistered")}</TH></TR></THead>
            <TBody>
              {o.recent.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.legalName}</TD>
                  <TD>{tc(c.type)}</TD>
                  <TD>{c.country.flag} {c.country.code}</TD>
                  <TD><AccountStatusBadge status={c.status} /></TD>
                  <TD className="text-muted-foreground">{formatDate(c.createdAt, locale)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
