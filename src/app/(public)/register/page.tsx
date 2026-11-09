import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Apply" };

export default async function RegisterPage() {
  const [t, c] = await Promise.all([getTranslations("register"), getTranslations("common")]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-xl">{t("title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>{t("body")}</p>
        <Link href="/login" className="font-medium text-primary hover:underline">← {c("back")}</Link>
      </CardContent>
    </Card>
  );
}
