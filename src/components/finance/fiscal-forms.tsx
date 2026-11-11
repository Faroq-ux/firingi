"use client";
/** Certified invoicing (Moloni) settings and retries; paying a supplier invoice (English back office). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { payVendorInvoiceAction, retryFiscalAction, runFiscalQueueAction, saveFiscalSettingsAction } from "@/server/actions/invoicing";

type Opt = { id: number; name: string };
type Settings = {
  provider: "internal" | "moloni";
  moloni: { companyId: number | null; invoiceSetId: number | null; creditNoteSetId: number | null; maturityDateId: number | null; paymentMethodId: number | null; categoryId: number | null; unitId: number | null; exemptionReason: string; taxMap: Record<string, number> };
};
export type MoloniOptions = {
  ok: boolean; error?: string; companies: Opt[]; sets?: Opt[]; taxes?: (Opt & { value: number; zone: string })[]; maturity?: Opt[]; methods?: Opt[]; units?: Opt[]; categories?: Opt[];
  exemptions?: { code: string; name: string }[]; suggestedTaxMap?: Record<string, number>;
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return { pending, msg, setMsg, router, start };
}
const Msg = ({ msg }: { msg: { ok: boolean; text: string } | null }) => msg && <span role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</span>;

export function FiscalSettingsForm({ settings, options, rates, canEdit }: { settings: Settings; options: MoloniOptions; rates: string[]; canEdit: boolean }) {
  const { pending, msg, setMsg, router, start } = useRun();
  const [v, setV] = useState<Settings>(() => ({ ...settings, moloni: { ...settings.moloni, taxMap: Object.keys(settings.moloni.taxMap).length ? settings.moloni.taxMap : options.suggestedTaxMap ?? {} } }));
  const m = v.moloni;
  const set = (k: keyof Settings["moloni"], val: unknown) => setV({ ...v, moloni: { ...m, [k]: val } });
  const pick = (k: keyof Settings["moloni"], label: string, opts: Opt[] | undefined) => (
    <div className="space-y-1"><Label htmlFor={`m-${k}`}>{label}</Label>
      <Select id={`m-${k}`} value={String(m[k] ?? "")} disabled={!canEdit} onChange={(e) => set(k, e.target.value ? Number(e.target.value) : null)}>
        <option value="">— choose —</option>{(opts ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="fiscal-settings">
      <fieldset className="flex flex-wrap gap-6 text-sm"><legend className="mb-1 font-medium">Issue FIRINGI&apos;s invoices with</legend>
        <label className="flex items-center gap-2"><input type="radio" name="provider" checked={v.provider === "internal"} disabled={!canEdit} onChange={() => setV({ ...v, provider: "internal" })} /> FIRINGI&apos;s internal test numbering (not fiscal)</label>
        <label className="flex items-center gap-2"><input type="radio" name="provider" checked={v.provider === "moloni"} disabled={!canEdit || !options.ok} onChange={() => setV({ ...v, provider: "moloni" })} /> Moloni (certified by AT)</label>
      </fieldset>
      {options.ok ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {pick("companyId", "Moloni company", options.companies)}
            {pick("invoiceSetId", "Series for invoices", options.sets)}
            {pick("creditNoteSetId", "Series for credit notes", options.sets)}
            {pick("maturityDateId", "Default maturity (new customers)", options.maturity)}
            {pick("paymentMethodId", "Default payment method (new customers)", options.methods)}
            {pick("categoryId", "Category for new products", options.categories)}
            {pick("unitId", "Unit for new products", options.units)}
            <div className="space-y-1"><Label htmlFor="m-exemption">Exemption reason for 0 % lines</Label>
              <Select id="m-exemption" value={m.exemptionReason} disabled={!canEdit} onChange={(e) => set("exemptionReason", e.target.value)}>
                {(options.exemptions ?? [{ code: m.exemptionReason, name: m.exemptionReason }]).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">FIRINGI VAT rates → Moloni taxes</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="tax-map">
              {rates.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm"><span className="w-16 tabular-nums">{Number(r)} %</span>
                  <Select aria-label={`Moloni tax for ${Number(r)} %`} value={String(m.taxMap[r] ?? "")} disabled={!canEdit} onChange={(e) => { const t = { ...m.taxMap }; if (e.target.value) t[r] = Number(e.target.value); else delete t[r]; set("taxMap", t); }}>
                    <option value="">— not mapped —</option>{(options.taxes ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </label>
              ))}
            </div>
          </div>
        </>
      ) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="moloni-off">{options.error}</p>}
      {canEdit && <div className="flex items-center gap-3"><Button disabled={pending} onClick={() => start(async () => { const r = await saveFiscalSettingsAction(v); setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error }); if (r.ok) router.refresh(); })}>Save invoicing settings</Button><Msg msg={msg} /></div>}
    </div>
  );
}

export function RetryFiscal({ invoiceId }: { invoiceId: string }) {
  const { pending, msg, setMsg, router, start } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await retryFiscalAction({ invoiceId }); setMsg(r.ok ? { ok: r.data === "DONE", text: r.data === "DONE" ? "Issued" : `Still ${String(r.data).toLowerCase()}` } : { ok: false, text: r.error }); router.refresh(); })}>Send again</Button>
      <Msg msg={msg} />
    </span>
  );
}

export function RunFiscalQueue() {
  const { pending, msg, setMsg, router, start } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Msg msg={msg} />
      <Button variant="outline" disabled={pending} data-testid="run-queue" onClick={() => start(async () => { const r = await runFiscalQueueAction({}); setMsg(r.ok ? { ok: true, text: "skipped" in r.data ? String(r.data.skipped) : `${r.data.done} issued, ${r.data.pending} waiting, ${r.data.failed} failed` } : { ok: false, text: r.error }); router.refresh(); })}>Send pending now</Button>
    </span>
  );
}

export function PayVendorInvoice({ vendorInvoiceId, vendorId, amount }: { vendorInvoiceId: string; vendorId: string; amount: number }) {
  const { pending, msg, setMsg, router, start } = useRun();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  if (!open) return <span className="inline-flex items-center gap-2"><Button size="sm" onClick={() => setOpen(true)}>Record payout</Button><Msg msg={msg} /></span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="pay-form">
      <Input aria-label="Bank reference" placeholder="Bank reference" className="h-8 w-40" value={ref} onChange={(e) => setRef(e.target.value)} />
      <Input aria-label="Paid on" type="date" className="h-8 w-36" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        const r = await payVendorInvoiceAction({ vendorInvoiceId, vendorId, amount, reference: ref || null, paidAt: date });
        setOpen(false);
        setMsg(r.ok ? { ok: true, text: "Recorded" } : { ok: r.code === "APPROVAL_REQUIRED", text: r.error });
        router.refresh();
      })}>Paid {new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(amount)}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>✕</Button>
    </span>
  );
}
