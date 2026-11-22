"use client";
/** Phase 56: optional WhatsApp contact — "my phone number is also on WhatsApp", or a different WhatsApp number. */
import { useState } from "react";
import { Input, Label } from "@/components/ui/input";
import { PhoneWithCode } from "./phone-field";

const digits = (v: string | null | undefined) => (v ?? "").replace(/[^\d]/g, "");

/** Read the WhatsApp number from a submitted form: the phone number when "same" is ticked, else the WhatsApp field. */
export function whatsappFrom(fd: FormData): string | null {
  if (fd.get("whatsappSame") === "on") return String(fd.get("phone") ?? "").trim() || null;
  return String(fd.get("whatsapp") ?? "").trim() || null;
}

export function WhatsAppField({ label, sameLabel, hint, phone, value, error, dial }: { label: string; sameLabel: string; hint: string; phone?: string | null; value?: string | null; error?: string[]; /** the company country's code: the number gets it by default */ dial?: string }) {
  const [same, setSame] = useState(!!value && !!phone && digits(value) === digits(phone));
  return (
    <div className="space-y-1.5" data-testid="whatsapp-field">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="whatsappSame" checked={same} onChange={(e) => setSame(e.target.checked)} data-testid="whatsapp-same" />
        {sameLabel}
      </label>
      {!same && (
        <>
          <Label htmlFor="whatsapp">{label}</Label>
          {dial
            ? <PhoneWithCode id="whatsapp" name="whatsapp" dial={dial} defaultValue={value} testid="reg-whatsapp" />
            : <Input id="whatsapp" name="whatsapp" type="tel" placeholder="+351 912 345 678" defaultValue={value ?? ""} data-testid="reg-whatsapp" />}
        </>
      )}
      <p className="text-xs text-muted-foreground">{hint}</p>
      {error?.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
    </div>
  );
}
