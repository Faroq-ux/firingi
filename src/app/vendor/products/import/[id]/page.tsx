import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { importRun } from "@/server/integrations/catalogue-import";
import { IntegrationsHero, Steps } from "@/components/integrations/hero";
import { ImportRunView } from "@/components/integrations/import-run";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"]);
  const [t, locale, run] = await Promise.all([getTranslations("integrations"), getLocale(), importRun(ctx, (await params).id)]);
  const s = run.summary;
  const steps = [t("import.steps.upload"), t("import.steps.match"), t("import.steps.check"), t("import.steps.apply")];
  return (
    <>
      <Link href="/vendor/products/import" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />{t("import.title")}</Link>
      <IntegrationsHero title={run.status === "PREVIEW" ? t("run.title") : t(`runStatus.${run.status}`)} subtitle={run.heldReason && run.status === "PREVIEW" ? t("run.held", { reason: s.bigChanges ? t("run.bigWarn", { count: s.bigChanges }) : `${t("run.summary.errors")}: ${s.errors ?? 0} / ${s.total ?? 0}` }) : `${t(`source.${run.source}`)} · ${run.fileName ?? ""} · ${run.createdAt.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}`} locale={locale}
        stats={[{ label: t("run.summary.updates"), value: s.updates ?? 0 }, { label: t("run.summary.newOffers"), value: s.newOffers ?? 0 }, { label: t("run.summary.notFound"), value: s.notFound ?? 0 }, { label: t("run.summary.errors"), value: s.errors ?? 0 }]} />
      <Steps steps={steps} current={run.status === "PREVIEW" ? 2 : 4} />
      <ImportRunView runId={run.id} status={run.status} bigChanges={s.bigChanges ?? 0} result={{ applied: s.applied, failed: s.failed, failures: s.failures }}
        rows={run.rows.map((r) => ({ line: r.line, status: r.status, product: r.product, vendorSku: r.vendorSku, gtin: r.gtin, changes: r.changes, errors: r.errors, big: r.big }))} />
    </>
  );
}
