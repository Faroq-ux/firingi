import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listApprovals, listRules, ruleCategoryOptions } from "@/server/buying/approvals";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { RuleForm } from "@/components/buying/controls";
import { APPROVAL_TONE } from "@/lib/buying";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Approvals" };

export default async function Approvals() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view", "buyer.orders.approve"]);
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const approver = can(ctx, "buyer.orders.approve");
  const [rows, rules, cats] = await Promise.all([listApprovals(ctx), listRules(ctx, locale), approver ? ruleCategoryOptions(locale) : Promise.resolve([])]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title={t("approvalsTitle")} description={approver ? t("approvalsIntroManager") : t("approvalsIntroMember")} />
      <DataTable tableId="buy.approvals" testId="approvals-table" empty={t("noApprovals")}
        columns={[{ key: "date", label: t("asked"), type: "date" }, { key: "who", label: t("requestedBy"), filter: true }, { key: "kind", label: t("what"), filter: true }, { key: "total", label: t("total"), type: "money" }, { key: "why", label: t("rules") }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((a) => ({
          id: a.id, href: `/buy/orders/approvals/${a.id}`,
          cells: {
            date: { t: date.format(a.createdAt), v: a.createdAt.toISOString(), href: `/buy/orders/approvals/${a.id}` }, who: a.requestedBy ?? "—", kind: t(a.kind === "RECURRING" ? "kindRecurring" : a.quoteId ? "kindQuote" : "kindOrder"),
            total: { t: formatMoney(a.grossTotal, locale), v: Number(a.grossTotal) }, why: a.reasons.join(", "), status: { t: t(`as.${a.status}`), tone: APPROVAL_TONE[a.status] },
          },
        }))} />
      <Card className="mt-6" data-testid="approval-rules">
        <CardHeader><CardTitle>{t("rulesTitle")}</CardTitle><CardDescription>{t("rulesIntro")}</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {rules.length === 0 && <p className="text-sm text-muted-foreground">{t("noRules")}</p>}
          {approver ? (
            <>
              {rules.map((r) => <div key={r.id} className="rounded-xl border p-3"><RuleForm categories={cats} rule={{ id: r.id, name: r.name, minGross: r.minGross, categoryIds: r.categories.map((c) => c.id), isActive: r.isActive }} /></div>)}
              <div className="rounded-xl border border-dashed p-3"><p className="mb-2 text-sm font-medium">{t("newRule")}</p><RuleForm categories={cats} /></div>
            </>
          ) : (
            <ul className="space-y-1 text-sm">{rules.filter((r) => r.isActive).map((r) => <li key={r.id}>• <b>{r.name}</b>{r.minGross ? ` — ${t("fromAmountShort", { amount: formatMoney(r.minGross, locale) })}` : ""}{r.categories.length ? ` — ${r.categories.map((c) => c.name).join(", ")}` : ""}</li>)}</ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
