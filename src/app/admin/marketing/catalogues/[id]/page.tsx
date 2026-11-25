import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { catalogueEntries, editorLists, getCatalogue, mcAiReady } from "@/server/marketing/catalogues";
import { PageHeader } from "@/components/layout/page-header";
import { CatalogueEditor, type EditorValue } from "@/components/marketing/catalogue-editor";
import { cleanItems, mergeFilters, mergeOptions, type McFilters, type McLayout, type McOptions, type McScope } from "@/lib/marketing-catalogue";
import { UI_LOCALES } from "@/i18n/config";

export const metadata = { title: "Marketing Catalogue" };

export default async function CatalogueEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const c = await getCatalogue(ctx, (await params).id).catch(() => null);
  if (!c) notFound();
  const [lists, entries, aiReady] = await Promise.all([editorLists(ctx, c.countryId), catalogueEntries(c), mcAiReady()]);
  const nf = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
  const value: EditorValue = {
    title: c.title, subtitle: c.subtitle ?? "", intro: c.intro ?? "", locale: c.locale, countryId: c.countryId, scope: c.scope as McScope, scopeIds: c.scopeIds,
    filters: mergeFilters(c.filters as McFilters), items: cleanItems(c.items), layout: c.layout as McLayout, options: mergeOptions(c.options as McOptions),
  };
  return (
    <>
      <PageHeader icon={BookOpen} title={c.title} description="Marketing catalogue" />
      <CatalogueEditor key={c.updatedAt.toISOString()} id={c.id} initial={value} lists={{ ...lists, locales: [...UI_LOCALES] }} aiReady={aiReady} status={c.status} shareToken={c.shareToken} uploaded={!!c.uploadKey} views={c.views}
        entries={entries.map((e) => ({ offerId: e.offerId, name: e.name, pack: e.pack, price: e.priceNet ? `${nf.format(Number(e.priceNet))} excl. VAT` : null }))} />
    </>
  );
}
