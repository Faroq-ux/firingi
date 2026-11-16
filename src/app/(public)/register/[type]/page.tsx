import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { registrationCountries } from "@/server/services/registration";
import { checkInvite, publicLaunchInfo } from "@/server/launch/service";
import { pickLocalized } from "@/i18n/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyRegistrationForm, DriverRegistrationForm } from "./forms";

export const metadata = { title: "Apply" };
export const dynamic = "force-dynamic";

const MAP = { customer: "CUSTOMER", wholesaler: "WHOLESALER", distributor: "DISTRIBUTOR" } as const;
const REASON = { missing: "pilotText", invalid: "inviteInvalid", used: "inviteUsed", expired: "inviteExpired", revoked: "inviteInvalid", type: "inviteType" } as const;

export default async function RegisterTypePage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ ref?: string; invite?: string }> }) {
  const { type } = await params;
  const sp = await searchParams;
  const ref = (sp.ref ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || null;
  const [t, tl, locale, info] = await Promise.all([getTranslations("onboarding"), getTranslations("launch"), getLocale(), publicLaunchInfo()]);
  const legal = { termsUrl: info.termsUrl, privacyUrl: info.privacyUrl };
  if (type === "driver")
    return (
      <Card>
        <CardHeader><CardTitle className="text-xl">{t("choose.DRIVER")}</CardTitle></CardHeader>
        <CardContent><DriverRegistrationForm legal={legal} /></CardContent>
      </Card>
    );
  const companyType = MAP[type as keyof typeof MAP];
  if (!companyType) notFound();
  // Pilot: only with a valid invitation for this account type; the form is then locked to its country.
  const invite = info.pilot ? await checkInvite(sp.invite, companyType) : null;
  let countries = await registrationCountries(companyType);
  if (invite?.ok) countries = countries.filter((c) => c.code === invite.countryCode);
  return (
    <Card className="sm:-mx-24">
      <CardHeader>
        <CardTitle className="text-xl">{t(`choose.${companyType}`)}</CardTitle>
        <p className="text-sm text-muted-foreground">{t(`choose.${companyType}_desc`)}</p>
        <p className="rounded-md bg-primary/10 p-2 text-sm font-medium text-primary">{t("choose.b2bOnly")}</p>
      </CardHeader>
      <CardContent>
        {invite && !invite.ok ? (
          <div className="space-y-2 rounded-xl border p-4" data-testid="pilot-closed">
            <p className="font-semibold">{tl("pilotTitle")}</p>
            <p className="text-sm text-muted-foreground" data-testid="pilot-reason">{tl(REASON[invite.reason])}</p>
            {info.supportEmail && <p className="text-sm">{tl("pilotAsk")} <a className="font-medium text-primary hover:underline" href={`mailto:${info.supportEmail}`}>{info.supportEmail}</a></p>}
            <p className="text-sm">{t("choose.haveAccount")} <Link href="/login" className="font-medium text-primary hover:underline">{t("choose.signIn")}</Link></p>
          </div>
        ) : countries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("form.notOpen")}</p>
        ) : (
          <CompanyRegistrationForm
            type={companyType} referralCode={companyType === "DISTRIBUTOR" ? null : ref} legal={legal}
            invite={invite?.ok ? { code: invite.code, email: invite.email, companyName: invite.companyName } : null}
            countries={countries.map((c) => ({ code: c.code, label: `${c.flag ?? ""} ${pickLocalized(c.name, locale)}`, vatPrefix: c.vatPrefix ?? c.code, cities: c.cities }))}
          />
        )}
        <p className="mt-4 text-center text-sm"><Link href="/register" className="text-primary hover:underline">← {t("choose.title")}</Link></p>
      </CardContent>
    </Card>
  );
}
