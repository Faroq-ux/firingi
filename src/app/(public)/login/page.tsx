import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const t = await getTranslations("auth");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Suspense>
          <LoginForm labels={{
            email: t("email"), password: t("password"), submit: t("submit"), submitting: t("submitting"), invalid: t("invalid"), tooMany: t("tooMany"),
            codeTitle: t("codeTitle"), codeHint: t("codeHint"), backupHint: t("backupHint"), code: t("code"), verify: t("verify"), useBackup: t("useBackup"), useApp: t("useApp"), badCode: t("badCode"),
          }} />
        </Suspense>
        <p className="text-center text-sm text-muted-foreground">
          {t("noAccount")} <Link href="/register" className="font-medium text-primary hover:underline">{t("register")}</Link>
        </p>
      </CardContent>
    </Card>
  );
}
