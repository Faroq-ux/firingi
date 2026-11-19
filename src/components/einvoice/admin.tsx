"use client";
/** E-invoicing (Phase 46) — FIRINGI admin parts (English). */
import { useState } from "react";
import { CheckCheck, Play, RotateCcw, Save, Search, Send, ShieldCheck, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  checkEInvoiceAction, resendEInvoiceAction, runEInvoiceQueueAction, runPacksNowAction, saveEInvoiceSettingsAction, saveEntityEInvoiceAction, sendExistingInvoiceAction,
  simulateSupplierEInvoiceAction, verifyArchiveAction,
} from "@/server/actions/einvoice";
import { DOC_LANGUAGES, FORMAT_LABEL, FORMATS, PROVIDER_INFO, PROVIDERS, providerFits, type EInvoiceSettings, type LanguageSource } from "@/lib/einvoice";

const LANG_NAMES: Record<string, string> = {
  en: "English", "pt-PT": "Portuguese", es: "Spanish", fr: "French", de: "German", it: "Italian", nl: "Dutch", pl: "Polish", ro: "Romanian", cs: "Czech", sk: "Slovak", hu: "Hungarian", hr: "Croatian",
  sl: "Slovenian", bg: "Bulgarian", el: "Greek", da: "Danish", sv: "Swedish", fi: "Finnish", et: "Estonian", lv: "Latvian", lt: "Lithuanian", mt: "Maltese", nb: "Norwegian", is: "Icelandic",
};
const SOURCE_LABEL: Record<LanguageSource, string> = { CUSTOMER_COUNTRY: "The customer's country language", CUSTOMER_CHOICE: "The language the customer chose", ENTITY: "FIRINGI company's language" };

type Country = { code: string; name: string; flag: string | null };

export function EInvoiceSettingsForm({ initial, countries }: { initial: EInvoiceSettings; countries: Country[] }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<EInvoiceSettings>(initial);
  const box = (label: string, checked: boolean, on: (v: boolean) => void, testid?: string) => (
    <label className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 shrink-0" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> <span className="min-w-0">{label}</span></label>
  );
  const setRoute = (cc: string, patch: Partial<EInvoiceSettings["countries"][string]>) => {
    const r = { ...x.countries[cc], ...patch };
    if (!providerFits(r.provider, r.format, cc)) r.provider = (PROVIDERS.find((p) => providerFits(p, r.format, cc) && p !== "eu-hub") ?? "eu-hub");
    setX({ ...x, countries: { ...x.countries, [cc]: r } });
  };
  const prio = x.languagePriority;
  const setPrio = (i: number, v: LanguageSource) => {
    const next = [...prio];
    const j = next.indexOf(v);
    if (j >= 0) next[j] = next[i];
    next[i] = v;
    setX({ ...x, languagePriority: next });
  };
  return (
    <div className="space-y-6" data-testid="einvoice-settings">
      {box("E-invoicing on (off: documents are only e-mailed as PDF, as before)", x.enabled, (v) => setX({ ...x, enabled: v }), "es-enabled")}
      <div className="space-y-2">
        <p className="text-sm font-medium">Documents that go out / come in electronically</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {box("Customer invoices", x.documents.customerInvoices, (v) => setX({ ...x, documents: { ...x.documents, customerInvoices: v } }), "es-doc-invoices")}
          {box("Credit notes", x.documents.creditNotes, (v) => setX({ ...x, documents: { ...x.documents, creditNotes: v } }))}
          {box("Service invoices to suppliers (ads, plans, early payout)", x.documents.serviceInvoices, (v) => setX({ ...x, documents: { ...x.documents, serviceInvoices: v } }))}
          {box("Self-billing (FIRINGI issues the invoice of suppliers who agreed)", x.documents.selfBilling, (v) => setX({ ...x, documents: { ...x.documents, selfBilling: v } }), "es-doc-selfbilling")}
          {box("Receive suppliers' e-invoices and match them to statements", x.documents.receiveSupplier, (v) => setX({ ...x, documents: { ...x.documents, receiveSupplier: v } }))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Route per country (the recipient&apos;s country)</p>
        <p className="text-xs text-muted-foreground">Format and the service that carries it. <b>Mandatory</b>: every B2B document goes this way (clearance countries such as Poland&apos;s KSeF or Italy&apos;s SDI). Otherwise only customers who gave a Peppol id or chose e-invoices get one. KSeF, SDI and Verifactu are only used for FIRINGI&apos;s own company in that country; elsewhere a Peppol id falls back to Peppol. The EU-wide service carries any format for any country.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm" data-testid="es-routes">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Country</th><th className="pr-2">On</th><th className="pr-2">Format</th><th className="pr-2">Service</th><th className="pr-2">Mandatory</th><th className="pr-2">E-mail copy</th><th className="pr-2">Keep (years)</th></tr></thead>
            <tbody>
              {countries.map((c) => {
                const r = x.countries[c.code];
                if (!r) return null;
                return (
                  <tr key={c.code} className="border-t" data-testid={`es-route-${c.code}`}>
                    <td className="py-1 pr-2 whitespace-nowrap">{c.flag} {c.name}</td>
                    <td className="pr-2"><input type="checkbox" checked={r.enabled} onChange={(e) => setRoute(c.code, { enabled: e.target.checked })} aria-label={`${c.name} on`} /></td>
                    <td className="pr-2"><Select value={r.format} onChange={(e) => setRoute(c.code, { format: e.target.value as typeof r.format })} aria-label={`${c.name} format`} data-testid={`es-format-${c.code}`}>{FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}</Select></td>
                    <td className="pr-2"><Select value={r.provider} onChange={(e) => setRoute(c.code, { provider: e.target.value as typeof r.provider })} aria-label={`${c.name} service`} data-testid={`es-provider-${c.code}`}>{PROVIDERS.filter((p) => providerFits(p, r.format, c.code)).map((p) => <option key={p} value={p}>{PROVIDER_INFO[p].label}</option>)}</Select></td>
                    <td className="pr-2"><input type="checkbox" checked={r.mandatory} onChange={(e) => setRoute(c.code, { mandatory: e.target.checked })} aria-label={`${c.name} mandatory`} /></td>
                    <td className="pr-2"><input type="checkbox" checked={r.emailCopy} onChange={(e) => setRoute(c.code, { emailCopy: e.target.checked })} aria-label={`${c.name} e-mail copy`} /></td>
                    <td className="pr-2"><Input className="w-20" inputMode="numeric" value={String(x.retention[c.code] ?? 10)} onChange={(e) => setX({ ...x, retention: { ...x.retention, [c.code]: Math.min(30, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) } })} aria-label={`${c.name} keep years`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">Document language</p>
          <p className="text-xs text-muted-foreground">The first of these that gives a language is the document&apos;s language. The FIRINGI company&apos;s own language is added as a second language where that company says it must always be on its documents.</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2"><span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
              <Select value={prio[i]} onChange={(e) => setPrio(i, e.target.value as LanguageSource)} aria-label={`Language priority ${i + 1}`} data-testid={`es-prio-${i}`}>
                {(Object.keys(SOURCE_LABEL) as LanguageSource[]).map((k) => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}
              </Select></div>
          ))}
          {box("Customers and suppliers may choose their invoice language", x.allowCustomerLanguage, (v) => setX({ ...x, allowCustomerLanguage: v }))}
          {box("They may add a second language (bilingual documents)", x.allowBilingual, (v) => setX({ ...x, allowBilingual: v }))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Checks, matching & country rules</p>
          {box("Check every document against its format's rules before sending (errors stop it)", x.validateBeforeSend, (v) => setX({ ...x, validateBeforeSend: v }))}
          {box("Warnings also stop a document", x.blockOnWarnings, (v) => setX({ ...x, blockOnWarnings: v }))}
          {box("The e-mail copy also carries the XML (for the recipient's accountant or accounting software)", x.emailXml, (v) => setX({ ...x, emailXml: v }), "es-emailXml")}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="es-tol">Received e-invoices: match tolerance (EUR)</Label><Input id="es-tol" inputMode="decimal" value={String(x.autoMatchTolerance)} onChange={(e) => setX({ ...x, autoMatchTolerance: Number(e.target.value.replace(",", ".")) || 0 })} /></div>
            <div className="space-y-1"><Label htmlFor="es-mpp">Poland: split-payment text from (PLN, 0 = off)</Label><Input id="es-mpp" inputMode="numeric" value={String(x.plSplitPaymentFrom)} onChange={(e) => setX({ ...x, plSplitPaymentFrom: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          </div>
        </div>
      </div>
      <div className="space-y-2" data-testid="es-monthly">
        <p className="text-sm font-medium">Monthly pack for accountants</p>
        <p className="text-xs text-muted-foreground">On this day each month, every company that gave its accountant&apos;s e-mail gets last month&apos;s documents (invoices, credit notes, service and self-billed invoices) as XML with a PDF of the month&apos;s totals. Companies can also download it themselves.</p>
        <div className="grid gap-3 sm:grid-cols-[auto_10rem] sm:items-end">
          {box("Send the monthly pack", x.monthlyPack.enabled, (v) => setX({ ...x, monthlyPack: { ...x.monthlyPack, enabled: v } }), "es-pack-enabled")}
          <div className="space-y-1"><Label htmlFor="es-pack-day">Day of the month (1–28)</Label>
            <Input id="es-pack-day" inputMode="numeric" value={String(x.monthlyPack.day)} onChange={(e) => setX({ ...x, monthlyPack: { ...x.monthlyPack, day: Math.min(28, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) } })} data-testid="es-pack-day" /></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {box("The XML of every document", x.monthlyPack.includeXml, (v) => setX({ ...x, monthlyPack: { ...x.monthlyPack, includeXml: v } }))}
          {box("A PDF with the month's totals", x.monthlyPack.includeSummary, (v) => setX({ ...x, monthlyPack: { ...x.monthlyPack, includeSummary: v } }))}
          {box("Each document's PDF too", x.monthlyPack.includeInvoicePdfs, (v) => setX({ ...x, monthlyPack: { ...x.monthlyPack, includeInvoicePdfs: v } }))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} data-testid="es-save" onClick={() => run(() => saveEInvoiceSettingsAction(x), undefined, "Saved")}><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

type Entity = { id: string; legalName: string; country: { code: string; flag: string | null; defaultLanguageCode: string }; language: string | null; secondLanguage: string | null; requireOwnLanguage: boolean; peppolId: string | null };

export function EntityForm({ e }: { e: Entity }) {
  const { pending, error, done, run } = useRun();
  const [lang, setLang] = useState(e.language ?? "");
  const [second, setSecond] = useState(e.secondLanguage ?? "");
  const [own, setOwn] = useState(e.requireOwnLanguage);
  const [peppol, setPeppol] = useState(e.peppolId ?? "");
  return (
    <div className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_14rem_auto] lg:items-end" data-testid={`entity-${e.country.code}`}>
      <div className="min-w-0"><p className="font-medium">{e.country.flag} {e.legalName}</p><label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={own} onChange={(x) => setOwn(x.target.checked)} /> Its own language is always on its documents</label></div>
      <div className="space-y-1"><Label>Language</Label><Select value={lang} onChange={(x) => setLang(x.target.value)}><option value="">Country default ({LANG_NAMES[e.country.defaultLanguageCode] ?? e.country.defaultLanguageCode})</option>{DOC_LANGUAGES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</Select></div>
      <div className="space-y-1"><Label>Second language</Label><Select value={second} onChange={(x) => setSecond(x.target.value)}><option value="">None</option>{DOC_LANGUAGES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</Select></div>
      <div className="space-y-1"><Label>Peppol id</Label><Input value={peppol} placeholder="9946:PT517000008" onChange={(x) => setPeppol(x.target.value)} data-testid={`entity-peppol-${e.country.code}`} /></div>
      <div className="flex flex-col gap-1">
        <Button disabled={pending} data-testid={`entity-save-${e.country.code}`} onClick={() => run(() => saveEntityEInvoiceAction({ id: e.id, language: lang || null, secondLanguage: second || null, requireOwnLanguage: own, peppolId: peppol || null }), undefined, "Saved")}><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function RunQueueButton() {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending} data-testid="einv-run" onClick={() => run(() => runEInvoiceQueueAction({}), undefined, "Queue run")}><Spin on={pending} icon={Play} /> Send queued now</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function ResendButton({ id }: { id: string }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} data-testid="einv-resend" onClick={() => run(() => resendEInvoiceAction({ id }), undefined, "Sent again")}><Spin on={pending} icon={RotateCcw} /> Check & send again</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

type Finding = { code: string; severity: "error" | "warning"; message: string };
export function CheckButton({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [f, setF] = useState<Finding[] | null>(null);
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={pending} data-testid="einv-check" onClick={() => run(() => checkEInvoiceAction({ id }), (d) => setF((d as { findings: Finding[] }).findings))}><Spin on={pending} icon={Search} /> Check now</Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {f && (f.length === 0
        ? <p className="flex items-center gap-1 text-sm text-success" data-testid="einv-check-ok"><CheckCheck className="size-4" /> No problems found.</p>
        : <ul className="space-y-1 text-sm" data-testid="einv-check-findings">{f.map((x, i) => <li key={i} className={x.severity === "error" ? "text-destructive" : "text-amber-700 dark:text-warning"}><b>{x.code}</b> — {x.message}</li>)}</ul>)}
    </div>
  );
}

export function SendExistingButton({ invoiceId }: { invoiceId: string }) {
  const { pending, error, done, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} data-testid="einv-send-existing" onClick={() => run(() => sendExistingInvoiceAction({ invoiceId }), undefined, "Sent")}><Spin on={pending} icon={Send} /> Send as e-invoice</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function VerifyArchiveButton() {
  const { pending, error, run } = useRun();
  const [r, setR] = useState<{ checked: number; intact: number; broken: { number: string; reason: string }[] } | null>(null);
  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={pending} data-testid="einv-verify" onClick={() => run(() => verifyArchiveAction({}), (d) => setR(d as typeof r))}><Spin on={pending} icon={ShieldCheck} /> Check the archive</Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {r && <p className="text-sm" data-testid="einv-verify-result">{r.intact} of {r.checked} files intact{r.broken.length ? ` — problems: ${r.broken.map((b) => `${b.number} (${b.reason})`).join(", ")}` : "."}</p>}
    </div>
  );
}

export function SimulateInboundForm({ statements }: { statements: { id: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [id, setId] = useState(statements[0]?.id ?? "");
  const [delta, setDelta] = useState("0");
  if (!statements.length) return <p className="text-sm text-muted-foreground">No open supplier statements to test with.</p>;
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" data-testid="einv-sim">
      <div className="min-w-0 space-y-1"><Label>Open statement</Label><Select value={id} onChange={(e) => setId(e.target.value)} data-testid="einv-sim-statement">{statements.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
      <div className="space-y-1"><Label>Net difference</Label><Input inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} /></div>
      <Button disabled={pending || !id} data-testid="einv-sim-send" onClick={() => run(() => simulateSupplierEInvoiceAction({ statementId: id, netDelta: Number(delta.replace(",", ".")) || 0 }), undefined, "Received")}><Spin on={pending} icon={Wand2} /> Receive test e-invoice</Button>
      <div className="sm:col-span-3"><Msg error={error} done={done} /></div>
    </div>
  );
}

export function RunPacksButton() {
  const { pending, error, run } = useRun();
  const [r, setR] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} data-testid="packs-run" onClick={() => run(() => runPacksNowAction({}), (d) => { const x = d as { period?: string; sent?: number; empty?: number; failed?: number }; setR(`${x.period}: ${x.sent ?? 0} sent, ${x.empty ?? 0} with nothing, ${x.failed ?? 0} failed`); })}><Spin on={pending} icon={Send} /> Send last month&apos;s packs now</Button>
      {r && <span className="text-xs" data-testid="packs-run-result">{r}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
