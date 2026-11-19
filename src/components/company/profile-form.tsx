"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { updateProfileAction } from "@/server/actions/onboarding";

export type ProfileData = {
  type: string; legalName: string; tradeName: string | null; taxId: string; vatNumber: string | null; email: string;
  phone: string | null; website: string | null; businessType: string | null; locked: boolean; countryLabel: string;
  legalForm: "COMPANY" | "SOLE_TRADER"; certificateCode: string | null; countryCode: string; activityCode: string | null; activityName: string; activityExample: string;
};
const BUSINESS_TYPES = ["restaurant", "kebab_pizza", "mini_market", "cafe_bar", "hotel", "catering", "retail", "other"];

export function ProfileForm({ data, canEdit }: { data: ProfileData; canEdit: boolean }) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await updateProfileAction({
            ...(data.locked ? {} : { legalName: s(fd, "legalName") ?? data.legalName, vatNumber: s(fd, "vatNumber") }),
            ...(data.locked ? {} : { legalForm: (s(fd, "legalForm") ?? data.legalForm) as ProfileData["legalForm"] }),
            certificateCode: s(fd, "certificateCode"),
            ...(data.activityCode ? {} : { activityCode: s(fd, "activityCode") }),
            tradeName: s(fd, "tradeName"), email: s(fd, "email") ?? "", phone: s(fd, "phone"), website: s(fd, "website"), businessType: s(fd, "businessType"),
          });
          setMsg(r.ok ? { ok: true, text: t("profile.saved") } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="legalName">{t("form.legalName")}</Label><Input id="legalName" name="legalName" defaultValue={data.legalName} disabled={data.locked} /></div>
        <div className="space-y-1.5"><Label htmlFor="tradeName">{t("form.tradeName")}</Label><Input id="tradeName" name="tradeName" defaultValue={data.tradeName ?? ""} /></div>
        <div className="space-y-1.5"><Label>{t("form.taxId")}</Label><Input value={`${data.countryLabel} · ${data.taxId}`} disabled readOnly /></div>
        <div className="space-y-1.5"><Label htmlFor="vatNumber">{t("form.vatNumber")}</Label><Input id="vatNumber" name="vatNumber" defaultValue={data.vatNumber ?? ""} disabled={data.locked} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="legalForm">{t("form.legalForm")}</Label>
          <Select id="legalForm" name="legalForm" defaultValue={data.legalForm} disabled={data.locked}>
            <option value="COMPANY">{t("legalForms.COMPANY")}</option>
            <option value="SOLE_TRADER">{t("legalForms.SOLE_TRADER")}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activityCode">{data.activityName} — {t("form.activityCode")}</Label>
          <Input id="activityCode" name="activityCode" defaultValue={data.activityCode ?? ""} disabled={!!data.activityCode} placeholder={data.activityExample} data-testid="profile-activity-code" />
          {!data.activityCode && <p className="text-xs text-muted-foreground">{t("form.activityCodeOnce")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="certificateCode">{t("form.certificateCode")}</Label>
          <Input id="certificateCode" name="certificateCode" defaultValue={data.certificateCode ?? ""} placeholder={data.countryCode === "PT" ? "0000-0000-0000" : ""} />
          <p className="text-xs text-muted-foreground">{data.countryCode === "PT" ? t("form.certificateCodeHintPt") : t("form.certificateCodeHint")}</p>
        </div>
        <div className="space-y-1.5"><Label htmlFor="email">{t("form.companyEmail")}</Label><Input id="email" name="email" type="email" defaultValue={data.email} required /></div>
        <div className="space-y-1.5"><Label htmlFor="phone">{t("form.phone")}</Label><Input id="phone" name="phone" defaultValue={data.phone ?? ""} /></div>
        <div className="space-y-1.5"><Label htmlFor="website">{t("profile.website")}</Label><Input id="website" name="website" defaultValue={data.website ?? ""} /></div>
        {data.type === "CUSTOMER" && (
          <div className="space-y-1.5">
            <Label htmlFor="businessType">{t("form.businessType")}</Label>
            <Select id="businessType" name="businessType" defaultValue={data.businessType ?? "other"}>
              {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{t(`businessTypes.${b}`)}</option>)}
            </Select>
          </div>
        )}
      </fieldset>
      {data.locked && <p className="text-xs text-muted-foreground" data-testid="profile-registration-locked">{t("profile.registrationLocked")}</p>}
      {msg && <p className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"} role="status">{msg.text}</p>}
      {canEdit && <Button type="submit" disabled={pending}>{t("profile.save")}</Button>}
    </form>
  );
}
