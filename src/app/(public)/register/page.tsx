import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building2, Store, Truck, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = { title: "Apply" };

const TYPES = [
  { key: "CUSTOMER", href: "/register/customer", icon: Building2 },
  { key: "WHOLESALER", href: "/register/wholesaler", icon: Store },
  { key: "DISTRIBUTOR", href: "/register/distributor", icon: Truck },
  { key: "DRIVER", href: "/register/driver", icon: UserRound },
] as const;

export default async function RegisterChoosePage() {
  const t = await getTranslations("onboarding.choose");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {TYPES.map(({ key, href, icon: Icon }) => (
          <Link key={key} href={href} className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:border-primary hover:bg-primary/5">
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Icon className="size-5" /></div>
            <div>
              <div className="font-medium">{t(key)}</div>
              <div className="text-sm text-muted-foreground">{t(`${key}_desc`)}</div>
            </div>
          </Link>
        ))}
        <p className="pt-2 text-center text-sm text-muted-foreground">
          {t("haveAccount")} <Link href="/login" className="font-medium text-primary hover:underline">{t("signIn")}</Link>
        </p>
      </CardContent>
    </Card>
  );
}
