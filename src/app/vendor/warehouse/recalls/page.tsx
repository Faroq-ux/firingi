import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listRecalls } from "@/server/warehouse/recalls";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type Tone } from "@/components/ui/data-table";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Recalls" };
const CLS: Record<string, Tone> = { CLASS_I: "destructive", CLASS_II: "warning", CLASS_III: "secondary" };

export default async function Recalls() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage"]);
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const rows = await listRecalls(ctx);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("recallsTitle")} description={t("recallsIntro")} actions={<Link href="/vendor/warehouse/trace" className={buttonVariants({ variant: "outline" })}>{t("traceALot")}</Link>} />
      <DataTable tableId="vendor.recalls" testId="recalls-table" empty={t("noRecalls")}
        columns={[{ key: "number", label: t("recall") }, { key: "date", label: t("created"), type: "date" }, { key: "product", label: t("product") }, { key: "lot", label: t("lot") }, { key: "cls", label: t("recallClass"), type: "badge", filter: true }, { key: "blocked", label: t("blockedUnits"), type: "number" }, { key: "progress", label: t("recipients"), type: "number" }, { key: "status", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/vendor/warehouse/recalls/${r.id}`,
          cells: {
            number: { t: r.number, mono: true, href: `/vendor/warehouse/recalls/${r.id}` }, date: { t: date.format(r.createdAt), v: r.createdAt.toISOString() },
            product: { t: `${pickLocalized(r.product, locale)} · ${pickLocalized(r.packaging, locale)}`, sub: r.sku ?? undefined }, lot: { t: r.lotCode ?? "—", mono: true },
            cls: { t: t(`class.${r.recallClass}`), tone: CLS[r.recallClass] }, blocked: r.blockedUnits, progress: { t: `${r.done} / ${r.recipients}`, v: r.recipients },
            status: { t: t(`recallStatus.${r.status}`), tone: r.status === "OPEN" ? "destructive" : "outline" },
          },
        }))} />
    </>
  );
}
