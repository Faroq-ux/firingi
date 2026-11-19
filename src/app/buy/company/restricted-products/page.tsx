import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { RestrictedSection, SpecialGoodsSection } from "@/components/company/sections";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { exLabels } from "@/components/excise/labels";

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.compliance.manage");
  const t = await getTranslations("onboarding.restricted");
  const { l } = await exLabels(); // Phase 43: licences live under Company › Licences too
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <p className="mb-4 text-sm"><Link href="/buy/company/licences" className="text-primary hover:underline">{l.licencesTitle} →</Link></p>
      <Card className="mb-4"><CardContent className="pt-5"><SpecialGoodsSection ctx={ctx} /></CardContent></Card>
      <RestrictedSection ctx={ctx} />
    </>
  );
}
