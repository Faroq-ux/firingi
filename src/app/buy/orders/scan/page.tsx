import { getLocale, getTranslations } from "next-intl/server";
import { ScanBarcode } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ScanReorder } from "@/components/app/scan-reorder";

export const metadata = { title: "Scan to reorder" };
export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.orders.place");
  const [t, locale] = await Promise.all([getTranslations("app"), getLocale()]);
  return (
    <>
      <PageHeader title={t("scanTitle")} icon={ScanBarcode} description={t("scanIntro")} />
      <Card className="mx-auto max-w-xl"><CardContent className="pt-6"><ScanReorder locale={locale} /></CardContent></Card>
    </>
  );
}
