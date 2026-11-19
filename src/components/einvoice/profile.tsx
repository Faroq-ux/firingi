"use client";
/** Phase 46 — a customer's / supplier's e-invoice settings (also used by FIRINGI staff on a company, with companyId). */
import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveEInvoiceProfileAction } from "@/server/actions/einvoice";
import { DOC_LANGUAGES } from "@/lib/einvoice";

type Profile = {
  delivery: string; peppolId: string | null; invoiceLanguage: string | null; secondLanguage: string | null; ksefNip: string | null; sdiCode: string | null;
  pecEmail: string | null; leitwegId: string | null; invoiceEmail: string | null; selfBilling: boolean; selfBillingAgreement: string | null; selfBillingSince: Date | string | null;
};

export function ProfileForm({ l, locale, profile, country, countryLanguage, vendor, allowLanguage, allowBilingual, allowSelfBilling, canEdit, companyId }: {
  l: Record<string, string>; locale: string; profile: Profile | null; country: string; countryLanguage: string; vendor: boolean;
  allowLanguage: boolean; allowBilingual: boolean; allowSelfBilling: boolean; canEdit: boolean; companyId?: string;
}) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState({
    delivery: profile?.delivery ?? "BOTH", peppolId: profile?.peppolId ?? "", invoiceLanguage: profile?.invoiceLanguage ?? "", secondLanguage: profile?.secondLanguage ?? "",
    ksefNip: profile?.ksefNip ?? "", sdiCode: profile?.sdiCode ?? "", pecEmail: profile?.pecEmail ?? "", leitwegId: profile?.leitwegId ?? "", invoiceEmail: profile?.invoiceEmail ?? "",
    selfBilling: profile?.selfBilling ?? false,
  });
  const names = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try { dn = new Intl.DisplayNames([locale], { type: "language" }); } catch { /* old browsers */ }
    return (c: string) => { const n = dn?.of(c === "nb" ? "nb" : c) ?? c; return n.charAt(0).toUpperCase() + n.slice(1); };
  }, [locale]);
  const f = (key: keyof typeof x, label: string, help?: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="min-w-0 space-y-1"><Label htmlFor={`ep-${key}`}>{label}</Label>
      <Input id={`ep-${key}`} value={String(x[key])} disabled={!canEdit} onChange={(e) => setX({ ...x, [key]: e.target.value })} data-testid={`ep-${key}`} {...extra} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}</div>
  );
  const since = profile?.selfBillingSince ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(profile.selfBillingSince)) : null;
  return (
    <div className="space-y-5" data-testid="einvoice-profile">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1"><Label htmlFor="ep-delivery">{l.delivery}</Label>
          <Select id="ep-delivery" value={x.delivery} disabled={!canEdit} onChange={(e) => setX({ ...x, delivery: e.target.value })} data-testid="ep-delivery">
            <option value="BOTH">{l.deliveryBoth}</option><option value="EINVOICE">{l.deliveryEinvoice}</option><option value="EMAIL">{l.deliveryEmail}</option>
          </Select>
          <p className="text-xs text-muted-foreground">{l.mandatoryNote}</p></div>
        {f("peppolId", l.peppolId, l.peppolHelp, { placeholder: "0208:0123456789", autoComplete: "off" })}
        {f("invoiceEmail", l.invoiceEmail, l.invoiceEmailHelp, { type: "email", inputMode: "email" })}
        {country === "PL" && f("ksefNip", l.ksefNip, undefined, { inputMode: "numeric" })}
        {country === "IT" && f("sdiCode", l.sdiCode, undefined, { maxLength: 7 })}
        {country === "IT" && f("pecEmail", l.pec, undefined, { type: "email" })}
        {country === "DE" && f("leitwegId", l.leitwegId)}
        {allowLanguage && (
          <div className="min-w-0 space-y-1"><Label htmlFor="ep-lang">{l.language}</Label>
            <Select id="ep-lang" value={x.invoiceLanguage} disabled={!canEdit} onChange={(e) => setX({ ...x, invoiceLanguage: e.target.value })} data-testid="ep-language">
              <option value="">{(l.languageDefault ?? "").replace("{lang}", names(countryLanguage))}</option>
              {DOC_LANGUAGES.map((c) => <option key={c} value={c}>{names(c)}</option>)}
            </Select></div>
        )}
        {allowLanguage && allowBilingual && (
          <div className="min-w-0 space-y-1"><Label htmlFor="ep-second">{l.secondLanguage}</Label>
            <Select id="ep-second" value={x.secondLanguage} disabled={!canEdit} onChange={(e) => setX({ ...x, secondLanguage: e.target.value })} data-testid="ep-second">
              <option value="">{l.none}</option>
              {DOC_LANGUAGES.map((c) => <option key={c} value={c}>{names(c)}</option>)}
            </Select></div>
        )}
      </div>
      {vendor && allowSelfBilling && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="ep-selfbilling">
          <p className="text-sm font-medium">{l.selfBilling}</p>
          <p className="text-sm text-muted-foreground">{l.selfBillingText}</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={x.selfBilling} disabled={!canEdit} onChange={(e) => setX({ ...x, selfBilling: e.target.checked })} data-testid="ep-selfbilling-agree" /> {l.selfBillingAgree}</label>
          {profile?.selfBilling && profile.selfBillingAgreement && since && <p className="text-xs text-muted-foreground" data-testid="ep-agreement">{(l.selfBillingSince ?? "").replace("{number}", profile.selfBillingAgreement).replace("{date}", since)}</p>}
        </div>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending} data-testid="ep-save" onClick={() => run(() => saveEInvoiceProfileAction({
            ...(companyId ? { companyId } : {}),
            delivery: x.delivery as "BOTH" | "EINVOICE" | "EMAIL", peppolId: x.peppolId || null, invoiceLanguage: x.invoiceLanguage || null, secondLanguage: x.secondLanguage || null,
            ksefNip: x.ksefNip || null, sdiCode: x.sdiCode || null, pecEmail: x.pecEmail || null, leitwegId: x.leitwegId || null, invoiceEmail: x.invoiceEmail || null,
            ...(vendor ? { selfBilling: x.selfBilling } : {}),
          }), undefined, l.saved)}><Spin on={pending} icon={Save} /> {l.save}</Button>
          <Msg error={error} done={done} />
        </div>
      ) : <p className="text-xs text-muted-foreground">{l.readOnly}</p>}
    </div>
  );
}
