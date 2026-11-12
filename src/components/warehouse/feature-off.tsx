/** Shown on a warehouse page FIRINGI switched off for the supplier. */
import { getTranslations } from "next-intl/server";
import { PowerOff } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export async function FeatureOff({ title }: { title: string }) {
  const t = await getTranslations("warehouse");
  return (
    <>
      <PageHeader title={title} />
      <Card data-testid="feature-off">
        <CardContent className="flex items-start gap-3 pt-6 text-sm">
          <PowerOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div><p className="font-medium">{t("featureOff.title")}</p><p className="text-muted-foreground">{t("featureOff.body")}</p></div>
        </CardContent>
      </Card>
    </>
  );
}
