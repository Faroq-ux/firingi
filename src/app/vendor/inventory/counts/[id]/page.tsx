import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { BIG_VARIANCE, getCount } from "@/server/inventory/warehouse";
import { offerLabel, offerOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CountSheet } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Stock count" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage"]);
  const { id } = await params;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const c = await getCount(ctx, id).catch(() => null);
  if (!c) notFound();
  const offers = c.canCount ? await offerOptions(ctx, locale) : [];
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={c.number} description={`${c.warehouse} · ${c.kind === "FULL" ? t("full") : t("cycle")} · ${date.format(c.createdAt)} · ${c.createdBy ?? ""}`}
        actions={<><Badge variant={c.status === "APPROVED" ? "success" : c.status === "SUBMITTED" ? "warning" : "secondary"} data-testid="count-status">{t(`count.${c.status}`)}</Badge><Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/vendor/inventory/counts">← {t("counts")}</Link></>} />
      {c.varianceValue !== null && c.status !== "OPEN" && <p className="mb-3 text-sm">{t("variance")}: <b className="tabular-nums">{c.varianceQty! > 0 ? "+" : ""}{c.varianceQty}</b> · <b className="tabular-nums">{formatMoney(c.varianceValue.toString(), locale)}</b></p>}
      {c.needsSecondPerson && <p className="mb-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground" data-testid="second-person">{t("secondPerson", { limit: BIG_VARIANCE })}</p>}
      <CountSheet id={c.id} status={c.status} canCount={c.canCount} canApprove={c.canApprove} offers={offers}
        lines={c.lines.map((l) => ({ id: l.id, label: offerLabel(l.product, l.packaging, l.sku, locale), lotCode: l.lotCode, expiresOn: l.expiresOn ? date.format(l.expiresOn) : null, expectedQty: l.expectedQty, countedQty: l.countedQty, variance: l.variance, varianceValue: l.varianceValue }))} />
    </>
  );
}
