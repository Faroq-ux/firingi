import { CheckCircle2, CircleSlash, Crown } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myPlan } from "@/server/plans/service";
import { PLAN_FEATURES } from "@/lib/plans";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChoosePlanButton } from "@/components/plans/vendor";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Plan & Billing" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.profile.manage", "vendor.invoices.view"]);
  const [m, t, locale] = await Promise.all([myPlan(ctx), getTranslations("plans"), getLocale()]);
  const money = (n: number | string) => formatMoney(String(n), locale);
  if (!m.enabled || !m.sub) {
    return (
      <>
        <PageHeader title={t("title")} description={t("intro")} icon={Crown} />
        <Card><CardContent className="pt-6 text-sm" data-testid="plans-off">{t("plansOff")}</CardContent></Card>
      </>
    );
  }
  const sub = m.sub;
  const current = sub.plan;
  const pendingName = sub.pending?.name ?? null;
  const limits: [string, number, number | null][] = [
    [t("limits.products"), m.usage.products, current.maxProducts], [t("limits.users"), m.usage.users, current.maxUsers],
    [t("limits.warehouses"), m.usage.warehouses, current.maxWarehouses], [t("limits.drivers"), m.usage.drivers, current.maxDrivers],
  ];
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={Crown} />
      <Card className="mb-4" data-testid="plan-status">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-5 text-sm">
          <div><div className="text-muted-foreground">{t("currentPlan")}</div><div className="text-lg font-semibold" data-testid="current-plan">{current.name}</div></div>
          {sub.status === "TRIAL" && <Badge className="bg-[var(--vivid-violet,#7c3aed)] text-white" data-testid="trial-badge">{t("trialLeft", { days: m.trialDaysLeft ?? 0, date: formatDate(sub.trialEndsAt!, locale) })}</Badge>}
          {sub.status === "ACTIVE" && sub.periodEnd && <div><div className="text-muted-foreground">{t("renews")}</div><div>{formatDate(sub.periodEnd, locale)}</div></div>}
          {pendingName && <Badge variant="secondary" data-testid="pending-plan">{t("pendingPlan", { plan: pendingName, date: formatDate((sub.status === "TRIAL" ? sub.trialEndsAt : sub.periodEnd) ?? new Date(), locale) })}</Badge>}
          <div><div className="text-muted-foreground">{t("commission")}</div><div data-testid="my-commission">{m.commission === null ? "—" : `${m.commission.toLocaleString(locale)} %`}</div></div>
          <div><div className="text-muted-foreground">{t("billing")}</div><div>{t(`billingKinds.${sub.billing}`)}</div></div>
        </CardContent>
      </Card>
      {sub.status === "TRIAL" && <p className="mb-4 rounded-md bg-primary/10 p-3 text-sm" data-testid="trial-note">{t("trialNote", { plan: m.plans.find((p) => p.code === m.settings.defaultPlanCode)?.name ?? "Free" })}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="plan-cards">
        {m.plans.map((p) => {
          const isCurrent = p.id === current.id && sub.status !== "TRIAL";
          const isPending = p.id === sub.pendingPlanId;
          return (
            <Card key={p.id} className={isCurrent ? "ring-2 ring-[var(--vivid-violet,#7c3aed)]" : ""} data-testid={`plan-${p.code}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2">{p.name}{isCurrent && <Badge>{t("current")}</Badge>}{isPending && <Badge variant="secondary">{t("chosenBadge")}</Badge>}</CardTitle>
                <p className="text-2xl font-semibold tabular-nums">{Number(p.monthlyPrice) > 0 ? money(p.monthlyPrice.toString()) : t("freePrice")}<span className="ml-1 text-sm font-normal text-muted-foreground">{Number(p.monthlyPrice) > 0 ? t("perMonth") : ""}</span></p>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{p.commissionPct === null ? t("commissionOwn") : t("commissionPlan", { pct: Number(p.commissionPct).toLocaleString(locale) })}</p>
                <ul className="space-y-1">
                  {PLAN_FEATURES.map((f) => (
                    <li key={f} className={`flex items-start gap-2 ${p.features.includes(f) ? "" : "text-muted-foreground"}`}>
                      {p.features.includes(f) ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success,#16a34a)]" /> : <CircleSlash className="mt-0.5 size-4 shrink-0" />}<span>{t(`features.${f}`)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{[
                  p.maxProducts ? t("lim.products", { n: p.maxProducts }) : t("lim.productsAny"),
                  p.maxUsers ? t("lim.users", { n: p.maxUsers }) : t("lim.usersAny"),
                  p.maxWarehouses ? t("lim.warehouses", { n: p.maxWarehouses }) : t("lim.warehousesAny"),
                  p.maxDrivers ? t("lim.drivers", { n: p.maxDrivers }) : t("lim.driversAny"),
                ].join(" · ")}</p>
                <p className="text-xs">{p.earlyPayModel === "OFF" ? t("earlyOff") : p.earlyPayModel === "PER_DAY" ? t("earlyPerDay", { rate: Number(p.earlyPayRate).toLocaleString(locale), min: money(p.earlyPayMinFee.toString()) }) : t("earlyFlat", { rate: Number(p.earlyPayRate).toLocaleString(locale), min: money(p.earlyPayMinFee.toString()) })}{p.freeEarlyPays > 0 ? ` · ${t("earlyFree", { n: p.freeEarlyPays })}` : ""}</p>
                {m.canChange && !isCurrent && !isPending && <ChoosePlanButton planId={p.id} label={sub.status === "TRIAL" ? t("chooseAfterTrial") : Number(p.monthlyPrice) > Number(current.monthlyPrice) ? t("upgrade") : t("switchAtEnd")} variant={Number(p.monthlyPrice) > Number(current.monthlyPrice) ? "default" : "outline"} />}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("usage")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm" data-testid="plan-usage">
            {limits.map(([label, used, max]) => (
              <div key={label}>
                <div className="flex justify-between"><span>{label}</span><span className="tabular-nums">{max ? `${used} / ${max}` : `${used} · ${t("noLimit")}`}</span></div>
                {max ? <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${used >= max ? "bg-destructive" : "bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]"}`} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} /></div> : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("invoices")}</CardTitle></CardHeader>
          <CardContent>
            {!m.invoices.length ? <p className="text-sm text-muted-foreground">{t("noPlanInvoices")}</p> : (
              <ul className="divide-y text-sm" data-testid="plan-invoices">
                {m.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <a className="font-mono text-primary hover:underline" href={`/api/invoices/${i.invoiceId}/pdf`} target="_blank" rel="noreferrer">{i.number ?? "—"}</a>
                    <span className="text-muted-foreground">{formatDate(i.periodStart, locale)} – {formatDate(i.periodEnd, locale)}</span>
                    {i.kind === "UPGRADE" && <Badge variant="secondary">{t("upgradeInvoice")}</Badge>}
                    <span className="ml-auto tabular-nums">{money(i.gross.toString())}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
