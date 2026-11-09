import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default async function NoAccessPage() {
  const [t, c] = await Promise.all([getTranslations("noAccess"), getTranslations("common")]);
  return (
    <Card>
      <CardContent className="space-y-3 py-8 text-center">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <SignOutButton label={c("signOut")} />
      </CardContent>
    </Card>
  );
}
