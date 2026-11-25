import { BookOpen } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { defaultCountryId, editorLists } from "@/server/marketing/catalogues";
import { PageHeader } from "@/components/layout/page-header";
import { CatalogueEditor } from "@/components/marketing/catalogue-editor";
import { MC_DEFAULT_OPTIONS } from "@/lib/marketing-catalogue";
import { UI_LOCALES } from "@/i18n/config";

export const metadata = { title: "New Marketing Catalogue" };

export default async function NewCataloguePage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.marketing.manage");
  const countryId = await defaultCountryId(ctx);
  const lists = await editorLists(ctx, countryId);
  return (
    <>
      <PageHeader icon={BookOpen} title="New marketing catalogue" description="Give it a title and choose who it is for — then pick the products (filters or AI)." />
      <CatalogueEditor id={null} lists={{ ...lists, locales: [...UI_LOCALES] }} entries={[]} aiReady={false} status="DRAFT" shareToken={null} uploaded={false} views={0}
        initial={{ title: "", subtitle: "", intro: "", locale: "pt-PT", countryId, scope: "ALL", scopeIds: [], filters: { bestSellers: true, max: 24 }, items: [], layout: "GRID6", options: MC_DEFAULT_OPTIONS }} />
    </>
  );
}
