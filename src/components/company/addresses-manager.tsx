"use client";
import { useRouter } from "next/navigation";
import { Portal } from "@/components/ui/portal";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { attachAddressProofAction, cancelAddressRequestAction, removeAddressAction, saveAddressWithProofAction } from "@/server/actions/onboarding";

export type AddressRow = {
  id: string; kind: string; label: string; line1: string; line2: string | null; postalCode: string; cityId: string | null; cityName: string;
  countryCode: string; countryFlag: string | null; contactName: string | null; phone: string | null; isDefault: boolean; tillLocked?: boolean;
};
export type AddressRequestRow = { id: string; action: string; status: string; kind: string; label: string; line: string; note: string | null; addressId: string | null; hasProof: boolean };
export type CountryOption = { code: string; label: string; cities: { id: string; name: string }[] };

function AddressDialog({ initial, kinds, countries, defaultCountry, onClose, onPending, approvalOn }: {
  initial?: AddressRow; kinds: string[]; countries: CountryOption[]; defaultCountry: string; onClose: () => void; onPending: () => void; approvalOn: boolean;
}) {
  const t = useTranslations("onboarding");
  const ta = useTranslations("addressRequests");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState(initial?.countryCode ?? defaultCountry);
  const cities = countries.find((c) => c.code === country)?.cities ?? [];
  const [cityId, setCityId] = useState(initial ? initial.cityId ?? "__other" : cities.length ? "" : "__other");
  return (
    <Portal>
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form
        className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const city = cities.find((c) => c.id === cityId);
          start(async () => {
            const out = new FormData();
            out.set("json", JSON.stringify({
              id: initial?.id, kind: String(fd.get("kind")), label: String(fd.get("label")), line1: String(fd.get("line1")),
              line2: String(fd.get("line2") || "") || null, postalCode: String(fd.get("postalCode")), countryCode: country,
              cityId: city?.id ?? null, cityName: city?.name ?? String(fd.get("cityName") || ""), contactName: String(fd.get("contactName") || "") || null,
              phone: String(fd.get("phone") || "") || null, isDefault: fd.get("isDefault") === "on",
            }));
            const proof = fd.get("proof");
            if (proof instanceof File && proof.size > 0) { out.set("proof", proof); out.set("proofIssuedOn", String(fd.get("proofIssuedOn") ?? "")); }
            const r = await saveAddressWithProofAction(out);
            if (r.ok) { if ((r.data as { pending?: boolean } | null)?.pending) onPending(); onClose(); router.refresh(); } else setError(r.error);
          });
        }}
      >
        <h2 className="text-lg font-semibold">{initial ? t("addr.edit") : t("addr.add")}</h2>
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="kind">{t("addr.kind")}</Label>
            <Select id="kind" name="kind" defaultValue={initial?.kind ?? kinds.find((k) => k !== "HEAD_OFFICE")} disabled={initial?.kind === "HEAD_OFFICE"}>
              {kinds.filter((k) => k !== "HEAD_OFFICE" || initial?.kind === "HEAD_OFFICE").map((k) => <option key={k} value={k}>{t(`addressKinds.${k}`)}</option>)}
            </Select>
            {initial?.kind === "HEAD_OFFICE" && <input type="hidden" name="kind" value="HEAD_OFFICE" />}
          </div>
          <div className="space-y-1.5"><Label htmlFor="label">{t("addr.label")}</Label><Input id="label" name="label" defaultValue={initial?.label} placeholder={t("addr.labelHint")} required /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="line1">{t("form.line1")}</Label><Input id="line1" name="line1" defaultValue={initial?.line1} required /></div>
          <div className="space-y-1.5"><Label htmlFor="line2">{t("form.line2")}</Label><Input id="line2" name="line2" defaultValue={initial?.line2 ?? ""} /></div>
          <div className="space-y-1.5"><Label htmlFor="postalCode">{t("form.postalCode")}</Label><Input id="postalCode" name="postalCode" defaultValue={initial?.postalCode} required /></div>
          <div className="space-y-1.5">
            <Label htmlFor="country">{t("form.country")}</Label>
            <Select id="country" value={country} onChange={(e) => { setCountry(e.target.value); setCityId(countries.find((c) => c.code === e.target.value)?.cities.length ? "" : "__other"); }}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">{t("form.city")}</Label>
            <Select id="city" value={cityId} onChange={(e) => setCityId(e.target.value)} required>
              <option value="" disabled>{t("form.chooseCity")}</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__other">{t("form.cityOther")}</option>
            </Select>
          </div>
          {cityId === "__other" && <div className="space-y-1.5"><Label htmlFor="cityName">{t("form.cityName")}</Label><Input id="cityName" name="cityName" defaultValue={initial?.cityName} required /></div>}
          <div className="space-y-1.5"><Label htmlFor="contactName">{t("addr.contactName")}</Label><Input id="contactName" name="contactName" defaultValue={initial?.contactName ?? ""} /></div>
          <div className="space-y-1.5"><Label htmlFor="phone">{t("form.phone")}</Label><Input id="phone" name="phone" defaultValue={initial?.phone ?? ""} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={initial?.isDefault} /> {t("addr.makeDefault")}</label>
        {approvalOn && (
          <fieldset className="space-y-2 rounded-md border p-3" data-testid="addr-proof">
            <legend className="px-1 text-sm font-medium">{ta("proofTitle")}</legend>
            <p className="text-xs text-muted-foreground">{ta("proofHint")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="proof">{ta("proofFile")}</Label><Input id="proof" name="proof" type="file" accept="image/*,application/pdf" data-testid="addr-proof-file" /></div>
              <div className="space-y-1.5"><Label htmlFor="proofIssuedOn">{ta("proofDate")}</Label><Input id="proofIssuedOn" name="proofIssuedOn" type="date" data-testid="addr-proof-date" /></div>
            </div>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("addr.cancel")}</Button>
          <Button type="submit" disabled={pending}>{t("addr.save")}</Button>
        </div>
      </form>
    </div>
    </Portal>
  );
}

export function AddressesManager({ rows, kinds, countries, defaultCountry, canEdit, approvalOn = false, requests = [] }: {
  rows: AddressRow[]; kinds: string[]; countries: CountryOption[]; defaultCountry: string; canEdit: boolean; approvalOn?: boolean; requests?: AddressRequestRow[];
}) {
  const t = useTranslations("onboarding");
  const ta = useTranslations("addressRequests");
  const [sent, setSent] = useState(false);
  const waiting = new Set(requests.filter((r) => r.status === "PENDING" && r.addressId).map((r) => r.addressId));
  const router = useRouter();
  const [editing, setEditing] = useState<AddressRow | "new" | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {approvalOn && <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="addr-approval-note">{ta("approvalNote")}</p>}
      {sent && <p className="rounded-md bg-[color:var(--success,#16a34a)]/10 p-2 text-sm" role="status" data-testid="addr-sent">{ta("sent")}</p>}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("addr.none")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((a) => (
          <div key={a.id} className="flex gap-3 rounded-lg border p-3 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{a.label}</span>
                <Badge variant="secondary">{t(`addressKinds.${a.kind}`)}</Badge>
                {a.isDefault && <Badge>{t("addr.default")}</Badge>}
                {a.tillLocked && <Badge variant="outline" data-testid="addr-till-locked">{ta("tillLocked")}</Badge>}
                {waiting.has(a.id) && <Badge variant="warning" data-testid="addr-waiting">{ta("pendingBadge")}</Badge>}
              </div>
              <p className="text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
              <p className="text-muted-foreground">{a.postalCode} {a.cityName} {a.countryFlag}</p>
              {canEdit && !a.tillLocked && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(a)}>{t("addr.edit")}</Button>
                  {a.kind !== "HEAD_OFFICE" && (
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}
                      onClick={() => confirm(t("addr.confirmRemove")) && start(async () => { const r = await removeAddressAction({ id: a.id }); if (!r.ok) alert(r.error); else if ((r.data as { pending?: boolean } | null)?.pending) setSent(true); router.refresh(); })}>
                      {t("addr.remove")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {canEdit && <Button variant="outline" onClick={() => setEditing("new")}><Plus /> {t("addr.add")}</Button>}
      {requests.length > 0 && (
        <div className="space-y-2" data-testid="addr-requests">
          <h3 className="text-sm font-semibold">{ta("requestsTitle")}</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-2 p-2" data-testid="addr-request">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{ta(`action${r.action}` as "actionCREATE")}</span> · <span>{r.label}</span> <Badge variant="secondary">{t(`addressKinds.${r.kind}`)}</Badge></div>
                  {r.line && <p className="break-words text-xs text-muted-foreground">{r.line}</p>}
                  {r.note && <p className="text-xs">{ta("note", { note: r.note })}</p>}
                  {r.status === "PENDING" && r.action !== "REMOVE" && (r.hasProof ? <p className="text-xs text-muted-foreground" data-testid="addr-request-proof">{ta("proofAttached")}</p> : canEdit && <AttachProof id={r.id} />)}
                </div>
                <Badge variant={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "destructive" : r.status === "PENDING" ? "warning" : "secondary"} data-testid="addr-request-status">{ta(`status${r.status}` as "statusPENDING")}</Badge>
                {canEdit && r.status === "PENDING" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await cancelAddressRequestAction({ id: r.id }); router.refresh(); })} data-testid="addr-request-withdraw">{ta("withdraw")}</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <AddressDialog initial={editing === "new" ? undefined : editing} kinds={kinds} countries={countries} defaultCountry={defaultCountry} onClose={() => setEditing(null)} onPending={() => setSent(true)} approvalOn={approvalOn} />
      )}
    </div>
  );
}

/** Attach the till invoice (photo / scan) to a request that is waiting without one. */
function AttachProof({ id }: { id: string }) {
  const ta = useTranslations("addressRequests");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-1 flex flex-wrap items-end gap-2" data-testid="addr-attach" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("id", id); start(async () => { const r = await attachAddressProofAction(fd); if (r.ok) router.refresh(); else setError(r.error); }); }}>
      <span className="w-full text-xs text-amber-700 dark:text-amber-400">{ta("proofMissing")}</span>
      <Input name="proof" type="file" accept="image/*,application/pdf" className="h-8 max-w-[14rem] text-xs" aria-label={ta("proofFile")} required data-testid="addr-attach-file" />
      <Input name="proofIssuedOn" type="date" className="h-8 w-[9.5rem] text-xs" aria-label={ta("proofDate")} required data-testid="addr-attach-date" />
      <Button size="sm" variant="outline" disabled={pending} data-testid="addr-attach-save">{ta("attach")}</Button>
      {error && <span className="w-full text-xs text-destructive" role="alert">{error}</span>}
    </form>
  );
}
