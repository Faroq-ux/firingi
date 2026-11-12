"use client";
/** Supplier side of compliance (Phase 28): upload / renew a certificate, withdraw an upload. */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { uploadCertificateAction, withdrawCertificateAction } from "@/server/actions/compliance";

export function CertUploadForm({ typeId, needsNumber, hasExpiry, label, testId }: { typeId: string; needsNumber: boolean; hasExpiry: boolean; label: string; testId?: string }) {
  const t = useTranslations("compliance");
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={testId}><Upload className="size-4" />{label}</Button>;
  return (
    <form
      ref={form}
      className="grid gap-3 rounded-xl border border-dashed p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("typeId", typeId);
        run(() => uploadCertificateAction(fd), () => { form.current?.reset(); setOpen(false); }, t("uploaded"));
      }}
    >
      <div className="space-y-1.5"><Label htmlFor={`n-${typeId}`}>{t("number")}{needsNumber ? " *" : ""}</Label><Input id={`n-${typeId}`} name="number" required={needsNumber} maxLength={80} /></div>
      <div className="space-y-1.5"><Label htmlFor={`i-${typeId}`}>{t("issuer")}</Label><Input id={`i-${typeId}`} name="issuer" maxLength={120} /></div>
      <div className="space-y-1.5"><Label htmlFor={`d-${typeId}`}>{t("issuedOn")}</Label><Input id={`d-${typeId}`} name="issuedOn" type="date" max={today} /></div>
      {hasExpiry && <div className="space-y-1.5"><Label htmlFor={`e-${typeId}`}>{t("expiresOnLabel")} *</Label><Input id={`e-${typeId}`} name="expiresOn" type="date" min={today} required /></div>}
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`f-${typeId}`}>{t("file")} *</Label><Input id={`f-${typeId}`} name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={Upload} />{pending ? t("uploading") : t("upload")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}><X className="size-4" />{t("cancel")}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function WithdrawCert({ id }: { id: string }) {
  const t = useTranslations("compliance");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => withdrawCertificateAction({ id }))}>{t("withdraw")}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
