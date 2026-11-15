import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { registrationCountries } from "@/server/services/registration";
import { pickLocalized } from "@/i18n/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyRegistrationForm, DriverRegistrationForm } from "./forms";

export const metadata = { title: "Apply" };

const MAP = { customer: "CUSTOMER", wholesaler: "WHOLESALER", distributor: "DISTRIBUTOR" } as const;

export default async function RegisterTypePage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { type } = await params;
  const ref = ((await searchParams).ref ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || null;
  const [t, locale] = await Promise.all([getTranslations("onboarding"), getLocale()]);
  if (type === "driver")
    return (
      <Card>
        <CardHeader><CardTitle className="text-xl">{t("choose.DRIVER")}</CardTitle></CardHeader>
        <CardContent><DriverRegistrationForm /></CardContent>
      </Card>
    );
  const companyType = MAP[type as keyof typeof MAP];
  if (!companyType) notFound();
  const countries = await registrationCountries(companyType);
  return (
    <Card className="sm:-mx-24">
      <CardHeader>
        <CardTitle className="text-xl">{t(`choose.${companyType}`)}</CardTitle>
        <p className="text-sm text-muted-foreground">{t(`choose.${companyType}_desc`)}</p>
        <p className="rounded-md bg-primary/10 p-2 text-sm font-medium text-primary">{t("choose.b2bOnly")}</p>
      </CardHeader>
      <CardContent>
        {countries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("form.notOpen")}</p>
        ) : (
          <CompanyRegistrationForm
            type={companyType} referralCode={companyType === "DISTRIBUTOR" ? null : ref}
            countries={countries.map((c) => ({ code: c.code, label: `${c.flag ?? ""} ${pickLocalized(c.name, locale)}`, vatPrefix: c.vatPrefix ?? c.code, cities: c.cities }))}
          />
        )}
        <p className="mt-4 text-center text-sm"><Link href="/register" className="text-primary hover:underline">← {t("choose.title")}</Link></p>
      </CardContent>
    </Card>
  );
}
