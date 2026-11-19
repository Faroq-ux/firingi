"use client";
import { activityScheme, MAX_SECONDARY_ACTIVITY_CODES } from "@/lib/activity-code";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Select } from "@/components/ui/input";
import { registerCompanyAction, registerDriverAction } from "@/server/actions/onboarding";

type Country = { code: string; label: string; vatPrefix: string; cities: { id: string; name: string }[] };
const BUSINESS_TYPES = ["restaurant", "kebab_pizza", "mini_market", "cafe_bar", "hotel", "catering", "retail", "other"] as const;

function Field({ id, label, errors, hint, children }: { id: string; label: string; errors?: string[]; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError messages={errors} />
    </div>
  );
}

type Invite = { code: string; email: string; companyName: string } | null;
type Legal = { termsUrl: string | null; privacyUrl: string | null };

/** "I accept the terms of service and privacy policy" — links when FIRINGI has set them (Phase 33). */
function TermsText({ legal }: { legal?: Legal }) {
  const t = useTranslations("onboarding");
  const tl = useTranslations("launch");
  if (!legal?.termsUrl && !legal?.privacyUrl) return <>{t("form.acceptTerms")}</>;
  const a = (href: string | null) => {
    const LegalLink = (chunks: React.ReactNode) => href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">{chunks}</a> : <>{chunks}</>;
    return LegalLink;
  };
  return <>{tl.rich("acceptTerms", { terms: a(legal.termsUrl), privacy: a(legal.privacyUrl) })}</>;
}

export function CompanyRegistrationForm({ type, countries, referralCode = null, invite = null, legal }: { type: "DISTRIBUTOR" | "WHOLESALER" | "CUSTOMER"; countries: Country[]; referralCode?: string | null; invite?: Invite; legal?: Legal }) {
  const t = useTranslations("onboarding");
  const tsa = useTranslations("specialAccess");
  const tl = useTranslations("launch");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [country, setCountry] = useState(countries[0].code);
  const [cityId, setCityId] = useState(countries[0].cities.length ? "" : "__other");
  const [vat, setVat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const c = countries.find((x) => x.code === country)!;
  const s = (fd: FormData, k: string) => (String(fd.get(k) ?? "").trim() || null);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const city = c.cities.find((x) => x.id === cityId);
        start(async () => {
          const r = await registerCompanyAction({
            type, countryCode: country, legalName: s(fd, "legalName") ?? "", tradeName: s(fd, "tradeName"), taxId: s(fd, "taxId") ?? "",
            vatNumber: s(fd, "vatNumber"), activityCode: s(fd, "activityCode"), activityCodes: s(fd, "activityCodes"), sellsRestricted: fd.getAll("sellsRestricted").map(String) as ("TOBACCO" | "ALCOHOL" | "VAPING")[], companyEmail: s(fd, "companyEmail") ?? "", phone: s(fd, "phone") ?? "", businessType: s(fd, "businessType"),
            ownerName: s(fd, "ownerName") ?? "", ownerEmail: s(fd, "ownerEmail") ?? "", password: String(fd.get("password") ?? ""),
            line1: s(fd, "line1") ?? "", line2: s(fd, "line2"), postalCode: s(fd, "postalCode") ?? "",
            cityId: city?.id ?? null, cityName: city?.name ?? s(fd, "cityName") ?? "", acceptTerms: fd.get("acceptTerms") === "on", businessDeclaration: fd.get("businessDeclaration") === "on",
            referralCode: s(fd, "referralCode"), invite: invite?.code ?? null,
          } as Parameters<typeof registerCompanyAction>[0]);
          if (r.ok) { router.push(r.data.redirectTo); router.refresh(); }
          else { setError(r.error); setFe(r.fieldErrors ?? {}); window.scrollTo({ top: 0, behavior: "smooth" }); }
        });
      }}
    >
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {invite && <p className="rounded-md bg-primary/10 p-2 text-sm font-medium text-primary" data-testid="invite-note">✉️ {tl("invited", { company: invite.companyName })}</p>}
      {referralCode && (
        <p className="rounded-md bg-[color-mix(in_oklab,var(--vivid-teal)_12%,transparent)] p-2 text-sm" data-testid="referral-note">
          <input type="hidden" name="referralCode" value={referralCode} />
          🎁 {t("form.referral", { code: referralCode })}
        </p>
      )}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">{t("form.company")}</legend>
        <Field id="country" label={t("form.country")} errors={fe.countryCode}>
          <Select id="country" value={country} onChange={(e) => { setCountry(e.target.value); setVat(""); setCityId(countries.find((x) => x.code === e.target.value)?.cities.length ? "" : "__other"); }}>
            {countries.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </Select>
        </Field>
        <Field id="legalName" label={t("form.legalName")} errors={fe.legalName}><Input id="legalName" name="legalName" required defaultValue={invite?.companyName} /></Field>
        <Field id="tradeName" label={t("form.tradeName")}><Input id="tradeName" name="tradeName" /></Field>
        <Field id="taxId" label={t("form.taxId")} errors={fe.taxId}>
          <Input id="taxId" name="taxId" required inputMode={country === "PT" ? "numeric" : undefined}
            onChange={(e) => { if (country === "PT") setVat(e.target.value.replace(/\D/g, "") ? `PT${e.target.value.replace(/\D/g, "")}` : ""); }} />
        </Field>
        <Field id="vatNumber" label={t("form.vatNumber")} errors={fe.vatNumber} hint={t("form.vatHint")}>
          <Input id="vatNumber" name="vatNumber" required value={vat} onChange={(e) => setVat(e.target.value)} readOnly={country === "PT"} placeholder={`${c.vatPrefix}…`} />
        </Field>
        <Field id="activityCode" label={`${activityScheme(country).name} — ${t("form.activityCode")}`} errors={fe.activityCode} hint={t("form.activityCodeHint", { example: activityScheme(country).example })}>
          <Input id="activityCode" name="activityCode" required={type === "CUSTOMER"} autoComplete="off" placeholder={activityScheme(country).example} data-testid="reg-activity-code" />
        </Field>
        <Field id="activityCodes" label={t("form.activityCodesSecondary", { scheme: activityScheme(country).name })} errors={fe.activityCodes} hint={t("form.activityCodesHint", { max: MAX_SECONDARY_ACTIVITY_CODES })}>
          <Input id="activityCodes" name="activityCodes" autoComplete="off" placeholder={`${activityScheme(country).example}, …`} data-testid="reg-activity-codes" />
        </Field>
        <Field id="companyEmail" label={t("form.companyEmail")} errors={fe.companyEmail}><Input id="companyEmail" name="companyEmail" type="email" required /></Field>
        <Field id="phone" label={t("form.phone")} errors={fe.phone}><Input id="phone" name="phone" type="tel" required /></Field>
        {type === "CUSTOMER" && (
          <Field id="businessType" label={t("form.businessType")}>
            <Select id="businessType" name="businessType" defaultValue="restaurant">
              {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{t(`businessTypes.${b}`)}</option>)}
            </Select>
          </Field>
        )}
        {type !== "DISTRIBUTOR" && (
          <fieldset className="space-y-1.5 sm:col-span-2" data-testid="reg-sells">
            <legend className="text-sm font-medium">{tsa("question")}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {(["TOBACCO", "ALCOHOL", "VAPING"] as const).map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="sellsRestricted" value={k} data-testid={`reg-sells-${k}`} /> {tsa(`kind${k}`)}</label>)}
            </div>
            <p className="text-xs text-muted-foreground">{tsa("questionHint")}</p>
          </fieldset>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">{t("form.headOffice")}</legend>
        <div className="sm:col-span-2"><Field id="line1" label={t("form.line1")} errors={fe.line1}><Input id="line1" name="line1" required /></Field></div>
        <Field id="line2" label={t("form.line2")}><Input id="line2" name="line2" /></Field>
        <Field id="postalCode" label={t("form.postalCode")} errors={fe.postalCode}><Input id="postalCode" name="postalCode" required placeholder={country === "PT" ? "1000-001" : ""} /></Field>
        <Field id="city" label={t("form.city")} errors={fe.cityName}>
          <Select id="city" value={cityId} onChange={(e) => setCityId(e.target.value)} required>
            <option value="" disabled>{t("form.chooseCity")}</option>
            {c.cities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value="__other">{t("form.cityOther")}</option>
          </Select>
        </Field>
        {cityId === "__other" && <Field id="cityName" label={t("form.cityName")}><Input id="cityName" name="cityName" required /></Field>}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">{t("form.owner")}</legend>
        <Field id="ownerName" label={t("form.ownerName")} errors={fe.ownerName}><Input id="ownerName" name="ownerName" required autoComplete="name" /></Field>
        <Field id="ownerEmail" label={t("form.ownerEmail")} errors={fe.ownerEmail}><Input id="ownerEmail" name="ownerEmail" type="email" required autoComplete="email" defaultValue={invite?.email} /></Field>
        <Field id="password" label={t("form.password")} errors={fe.password} hint={t("form.passwordHint")}>
          <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
        </Field>
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="businessDeclaration" required className="mt-1" /> <span>{t("form.businessDeclaration")}</span>
      </label>
      <FieldError messages={fe.businessDeclaration} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-1" /> <span data-testid="terms-text"><TermsText legal={legal} /></span>
      </label>
      <FieldError messages={fe.acceptTerms} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? t("form.submitting") : t("form.submit")}</Button>
    </form>
  );
}

export function DriverRegistrationForm({ legal }: { legal?: Legal } = {}) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string[]>>({});
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await registerDriverAction({
            name: String(fd.get("name")), email: String(fd.get("email")), password: String(fd.get("password")), phone: String(fd.get("phone")),
            licenceNumber: String(fd.get("licenceNumber")), licenceExpiry: String(fd.get("licenceExpiry") || "") || null,
            acceptTerms: fd.get("acceptTerms") === "on",
          } as Parameters<typeof registerDriverAction>[0]);
          if (r.ok) { router.push(r.data.redirectTo); router.refresh(); } else { setError(r.error); setFe(r.fieldErrors ?? {}); }
        });
      }}
    >
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <Field id="name" label={t("form.ownerName")} errors={fe.name}><Input id="name" name="name" required /></Field>
      <Field id="email" label={t("form.ownerEmail")} errors={fe.email}><Input id="email" name="email" type="email" required /></Field>
      <Field id="phone" label={t("form.phone")} errors={fe.phone}><Input id="phone" name="phone" type="tel" required /></Field>
      <Field id="licenceNumber" label={t("form.licenceNumber")} errors={fe.licenceNumber}><Input id="licenceNumber" name="licenceNumber" required /></Field>
      <Field id="licenceExpiry" label={t("form.licenceExpiry")}><Input id="licenceExpiry" name="licenceExpiry" type="date" /></Field>
      <Field id="password" label={t("form.password")} errors={fe.password} hint={t("form.passwordHint")}>
        <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
      </Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acceptTerms" required className="mt-1" /> <span><TermsText legal={legal} /></span></label>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? t("form.submitting") : t("form.submit")}</Button>
    </form>
  );
}
