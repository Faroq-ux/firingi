import { Wallet } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { branchOptions } from "@/server/multisite/branches";
import { listBudgets } from "@/server/multisite/budgets";
import { ruleCategoryOptions } from "@/server/buying/approvals";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetBar, BudgetForm } from "@/components/multisite/controls";
import { BUDGET_ACTION_TONE, pctTone } from "@/lib/multisite";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Budgets" };

export default async function Budgets() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.branches.manage", "buyer.orders.view", "buyer.orders.place", "buyer.reports.view"]);
  const manager = ctx.permissions.has("buyer.branches.manage");
  const [t, locale] = await Promise.all([getTranslations("multisite"), getLocale()]);
  const [rows, shops, cats] = await Promise.all([listBudgets(ctx), branchOptions(ctx), manager ? ruleCategoryOptions(locale) : Promise.resolve([])]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
  return (
    <>
      <PageHeader title={t("budgetsTitle")} description={t("budgetsIntro")} icon={Wallet} />
      <div className="grid gap-4 lg:grid-cols-2" data-testid="budgets">
        {rows.length === 0 && <Card className="lg:col-span-2"><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("noBudgets")}</CardContent></Card>}
        {rows.map((b) => (
          <Card key={b.id} className={b.isActive ? "" : "opacity-70"} data-testid="budget-card">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{b.name}<Badge variant="outline">{b.branch ?? t("wholeCompany")}</Badge><Badge variant={BUDGET_ACTION_TONE[b.action]}>{t(`act.${b.action}`)}</Badge>{!b.isActive && <Badge variant="outline">{t("inactive")}</Badge>}</CardTitle>
              <CardDescription>{t(`per.${b.period}`)} · {date.format(b.periodStart)} – {date.format(b.periodEnd)}{b.categoryIds.length ? ` · ${t("categoriesCount", { count: b.categoryIds.length })}` : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1"><span className="text-xl font-bold tabular-nums sm:text-2xl">{formatMoney(b.spent, locale)}</span><span className="text-sm text-muted-foreground">{t("ofAmount", { amount: formatMoney(b.amount, locale) })} · <Badge variant={pctTone(b.pct)}>{b.pct}%</Badge></span></div>
              <BudgetBar pct={b.pct} label={`${b.name}: ${b.pct}%`} />
              {manager && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">{t("edit")}</summary><div className="mt-3"><BudgetForm initial={{ ...b, branchId: b.branchId }} shops={shops} categories={cats} /></div></details>}
            </CardContent>
          </Card>
        ))}
      </div>
      {manager && (
        <Card className="mt-6">
          <CardHeader><CardTitle>{t("newBudget")}</CardTitle><CardDescription>{t("newBudgetHint")}</CardDescription></CardHeader>
          <CardContent><BudgetForm shops={shops} categories={cats} /></CardContent>
        </Card>
      )}
    </>
  );
}
