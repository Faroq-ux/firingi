import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { getRecall } from "@/server/warehouse/recalls";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { CloseRecall } from "@/components/warehouse/controls";
import { RecallView } from "@/components/warehouse/trace-view";

export const metadata = { title: "Recall" };

export default async function RecallPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage"]);
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const r = await getRecall(ctx, (await params).id, locale);
  return (
    <>
      <PageHeader title={`${t("recall")} ${r.number}`} description={`${r.product} · ${t("lot")} ${r.lotCode ?? "—"}`}
        actions={<Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/vendor/warehouse/trace?offer=${r.offerId}&lot=${encodeURIComponent(r.lotCode ?? "")}`}>{t("trace")}</Link>} />
      <RecallView r={r} t={t as never} locale={locale} />
      {r.status === "OPEN" && can(ctx, "vendor.recalls.manage") && <div className="mt-6"><CloseRecall id={r.id} /></div>}
    </>
  );
}
