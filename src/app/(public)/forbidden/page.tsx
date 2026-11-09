import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default async function ForbiddenPage() {
  const t = await getTranslations("forbidden");
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>{t("home")}</Link>
      </CardContent>
    </Card>
  );
}
