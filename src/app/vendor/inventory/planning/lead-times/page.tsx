import { Timer } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { myLeadTimes } from "@/server/planning/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { MeasuredToggle } from "@/components/planning/vendor";

export const metadata = { title: "Lead times" };

export default async function LeadTimes() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
  const [rows, t, locale] = await Promise.all([myLeadTimes(ctx), getTranslations("planning"), getLocale()]);
  const edit = can(ctx, "vendor.purchasing.manage");
  const nf = (v: number | null) => (v === null ? "—" : t("daysShort", { days: v.toLocaleString(locale, { maximumFractionDigits: 1 }) }));
  return (
    <>
      <PageHeader title={t("leadTitle")} description={t("leadIntro")} icon={Timer} />
      <Card>
        <CardContent className="pt-6">
          <DataTable tableId="vendor.planning.lead" testId="lead-times" empty={t("noSources")}
            columns={[
              { key: "name", label: t("col.supplier") }, { key: "kind", label: t("col.kind"), type: "badge", filter: true }, { key: "stated", label: t("col.stated"), type: "number" },
              { key: "measured", label: t("col.measured"), type: "number" }, { key: "p90", label: t("col.p90"), type: "number" }, { key: "ontime", label: t("col.onTime"), type: "number" },
              { key: "fill", label: t("col.fill"), type: "number" }, { key: "used", label: t("col.used"), type: "number" }, { key: "choice", label: "" },
            ]}
            rows={rows.filter((s) => s.active || s.stats.orders > 0).map((s) => ({
              id: s.key,
              cells: {
                name: { t: s.name, sub: t("ordersCount", { count: s.stats.orders }) },
                kind: { t: s.kind === "OUTSIDE" ? t("kindOutside") : "FIRINGI", tone: s.kind === "OUTSIDE" ? "outline" : "default" },
                stated: { t: nf(s.stated), v: s.stated ?? -1 },
                measured: { t: nf(s.stats.measured), v: s.stats.measured ?? -1, tone: s.stated !== null && s.stats.measured !== null && s.stats.measured > s.stated + 0.5 ? "warning" : undefined },
                p90: { t: nf(s.stats.p90), v: s.stats.p90 ?? -1 },
                ontime: { t: s.stats.onTimePct === null ? "—" : `${s.stats.onTimePct} %`, v: s.stats.onTimePct ?? -1, tone: s.stats.onTimePct !== null && s.stats.onTimePct < 70 ? "warning" : undefined },
                fill: { t: s.stats.fillPct === null ? "—" : `${s.stats.fillPct} %`, v: s.stats.fillPct ?? -1 },
                used: { t: `${t("daysShort", { days: s.days })} · ${t(`leadBasis.${s.basis}`)}`, v: s.days },
                choice: { t: "", node: s.kind === "OUTSIDE" ? <MeasuredToggle supplierId={s.id} on={s.useMeasured} canEdit={edit} /> : <span className="text-xs text-muted-foreground">{t("measuredAuto")}</span> },
              },
            }))} />
          <p className="mt-3 text-xs text-muted-foreground">{t("leadHint")}</p>
        </CardContent>
      </Card>
    </>
  );
}
