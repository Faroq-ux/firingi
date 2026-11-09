/**
 * Placeholder for sidebar pages that belong to later phases. It still enforces the
 * page's permission, so hidden pages can't be opened by typing the URL.
 */
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Construction } from "lucide-react";
import { pagePermission, pagePortal, type Portal } from "@/server/rbac/guard";
import { findNavItem } from "@/config/nav/resolve";
import { PHASE_LABEL } from "@/config/nav/types";
import { pickLocalized } from "@/i18n/config";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "./page-header";

export async function ComingSoon({ portal, slug }: { portal: Portal; slug: string[] }) {
  const ctx = await pagePortal(portal);
  const found = findNavItem(portal, `/${portal}/${slug.join("/")}`);
  if (!found) notFound();
  pagePermission(ctx, found.item.permission);
  const [locale, t] = await Promise.all([getLocale(), getTranslations("comingSoon")]);

  return (
    <>
      <PageHeader title={pickLocalized(found.item.label, locale)} description={pickLocalized(found.section.label, locale)} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Construction className="size-6" /></div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t("body")}</p>
          <p className="text-sm font-medium">{t("planned", { phase: pickLocalized(PHASE_LABEL[found.item.phase], locale) })}</p>
        </CardContent>
      </Card>
    </>
  );
}
