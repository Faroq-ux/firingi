"use client";
/** Admin › Finance › Accounting export: range + journals + layout → preview (balanced?) → download; account mapping. */
import { useState, useTransition } from "react";
import { Check, Download, Loader2, Scale, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CountUp } from "@/components/motion/count-up";
import { accountingPreviewAction, saveAccountMapAction } from "@/server/actions/integrations";

type Journal = "SALES" | "CREDIT_NOTES" | "RECEIPTS" | "SUPPLIER_INVOICES" | "PAYOUTS";
type Map = { customers: string; suppliers: string; sales: string; purchases: string; bank: string; cash: string; cardClearing: string; excise: string; fxGain: string; fxLoss: string; vatOutput: Record<string, string>; vatInput: Record<string, string>; perPartner: boolean; journals: Record<Journal, string>; decimal: "comma" | "dot" };
type Preview = { byJournal: { journal: Journal; label: string; count: number; net: string; vat: string; gross: string }[]; documents: number; entries: number; debit: string; credit: string; balanced: boolean; sample: { headers: string[]; rows: (string | number | null)[][] } };

const TONES: Record<Journal, string> = { SALES: "tone-blue", CREDIT_NOTES: "tone-pink", RECEIPTS: "tone-teal", SUPPLIER_INVOICES: "tone-violet", PAYOUTS: "tone-orange" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function AccountingExport({ journals, formats, mapping }: { journals: { key: Journal; label: string }[]; formats: { key: string; label: string }[]; mapping: Map }) {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))));
  const [to, setTo] = useState(iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))));
  const [chosen, setChosen] = useState<Journal[]>(journals.map((j) => j.key));
  const [format, setFormat] = useState("documents");
  const [file, setFile] = useState<"xlsx" | "csv">("xlsx");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [m, setM] = useState<Map>(mapping);
  const [saved, setSaved] = useState<string | null>(null);
  const href = `/api/exports/accounting?from=${from}&to=${to}&journals=${chosen.join(",")}&format=${format}&file=${file}`;
  const money = (v: string | number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(v));
  const run = () => start(async () => { setError(null); const r = await accountingPreviewAction({ from, to, journals: chosen }); if (!r.ok) return setError(r.error); setPreview(r.data as Preview); });
  const acc = (k: keyof Map, label: string) => (
    <label key={k} className="grid gap-1 text-xs"><span className="text-muted-foreground">{label}</span><Input value={String(m[k])} onChange={(e) => setM({ ...m, [k]: e.target.value })} className="h-8 font-mono" /></label>
  );

  return (
    <div className="space-y-6" data-testid="accounting-export">
      <div className="grid gap-4 rounded-2xl border bg-card p-4 lg:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-sm"><span className="text-muted-foreground">From</span><input type="date" className="h-9 rounded-md border bg-background px-2" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="acc-from" /></label>
            <label className="grid gap-1 text-sm"><span className="text-muted-foreground">To</span><input type="date" className="h-9 rounded-md border bg-background px-2" value={to} onChange={(e) => setTo(e.target.value)} data-testid="acc-to" /></label>
          </div>
          <div className="flex flex-wrap gap-2">{journals.map((j) => (
            <label key={j.key} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm ${chosen.includes(j.key) ? "border-primary bg-primary/10 font-medium" : ""}`}>
              <input type="checkbox" className="sr-only" checked={chosen.includes(j.key)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, j.key] : c.filter((x) => x !== j.key)))} />{chosen.includes(j.key) && <Check className="size-3.5" aria-hidden />}{j.label}
            </label>
          ))}</div>
        </div>
        <div className="space-y-3">
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Layout</span>
            <select className="h-9 rounded-md border bg-background px-2" value={format} onChange={(e) => setFormat(e.target.value)} data-testid="acc-format">{formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
          </label>
          <div className="inline-flex rounded-lg border bg-muted/50 p-1">{(["xlsx", "csv"] as const).map((f) => <button key={f} onClick={() => setFile(f)} className={`rounded-md px-4 py-1 text-sm ${file === f ? "bg-card font-semibold shadow-sm" : "text-muted-foreground"}`}>{f === "xlsx" ? "Excel" : "CSV"}</button>)}</div>
          {format !== "documents" && format !== "entries" && <p className="text-xs text-muted-foreground">Import templates differ between versions and set-ups — have your accountant confirm the columns and the account mapping before the first import. The legal tax file remains the SAF-T (Invoices › SAF-T).</p>}
        </div>
        <div className="flex flex-col gap-2 lg:justify-end">
          <Button variant="outline" disabled={pending || !chosen.length} onClick={run} data-testid="acc-preview">{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Scale className="size-4" aria-hidden />}Preview</Button>
          <a href={chosen.length ? href : undefined} data-variant="default" className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="acc-download"><Download className="size-4" aria-hidden />Download</a>
        </div>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {preview && (
        <div className="space-y-4" data-testid="acc-result">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {preview.byJournal.filter((j) => chosen.includes(j.journal)).map((j, i) => (
              <div key={j.journal} className={`tile gloss motion-rise rounded-2xl border p-4 ${TONES[j.journal]}`} style={{ ["--i" as string]: i }}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{j.label}</p>
                <p className="text-2xl font-bold"><CountUp value={j.count} fmt="int" locale="en" /></p>
                <p className="text-xs text-muted-foreground">{money(j.gross)} gross · VAT {money(j.vat)}</p>
              </div>
            ))}
          </div>
          <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${preview.balanced ? "border-[color:color-mix(in_oklch,var(--vivid-teal)_50%,var(--border))] bg-[color:color-mix(in_oklch,var(--vivid-teal)_8%,var(--card))]" : "border-destructive/50 bg-destructive/10"}`} data-testid="acc-balance">
            <Scale className="size-5" aria-hidden /><b>{preview.balanced ? "Balanced" : "Not balanced"}</b>
            <span>{preview.entries} journal lines · debit {money(preview.debit)} · credit {money(preview.credit)}</span>
          </div>
          {preview.sample.rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-xs"><thead className="bg-muted/60"><tr>{preview.sample.headers.map((h) => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}</tr></thead>
              <tbody>{preview.sample.rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{c}</td>)}</tr>)}</tbody></table></div>
          )}
        </div>
      )}
      <details className="rounded-2xl border bg-card p-4">
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Settings2 className="size-4" aria-hidden />Chart of accounts (SNC defaults — confirm with your accountant)</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {acc("customers", "Customers")}{acc("suppliers", "Suppliers")}{acc("sales", "Sales")}{acc("purchases", "Purchases")}{acc("bank", "Bank")}{acc("cash", "Cash")}{acc("cardClearing", "Card / MB WAY clearing")}{acc("excise", "Excise duty (empty = in sales)")}{acc("fxGain", "Exchange gains")}{acc("fxLoss", "Exchange losses")}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["vatOutput", "vatInput"] as const).map((k) => (
            <fieldset key={k} className="grid grid-cols-5 gap-2 text-xs"><legend className="mb-1 text-sm font-medium">{k === "vatOutput" ? "VAT charged (sales)" : "VAT deductible (purchases)"}</legend>
              {Object.keys(m[k]).map((r) => <label key={r} className="grid gap-1"><span className="text-muted-foreground">{r === "other" ? "other" : `${r} %`}</span><Input className="h-8 font-mono" value={m[k][r]} onChange={(e) => setM({ ...m, [k]: { ...m[k], [r]: e.target.value } })} /></label>)}
            </fieldset>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-5">{journals.map((j) => <label key={j.key} className="grid gap-1 text-xs"><span className="text-muted-foreground">Journal · {j.label}</span><Input className="h-8 font-mono" value={m.journals[j.key]} onChange={(e) => setM({ ...m, journals: { ...m.journals, [j.key]: e.target.value } })} /></label>)}</div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={m.perPartner} onChange={(e) => setM({ ...m, perPartner: e.target.checked })} />Sub-account per customer / supplier (account + tax ID)</label>
          <label className="flex items-center gap-2">CSV decimals<select className="h-8 rounded-md border bg-background px-2" value={m.decimal} onChange={(e) => setM({ ...m, decimal: e.target.value as "comma" | "dot" })}><option value="comma">1234,56</option><option value="dot">1234.56</option></select></label>
          <Button size="sm" className="ml-auto" disabled={pending} data-testid="acc-save-map" onClick={() => start(async () => { const r = await saveAccountMapAction(m); setSaved(r.ok ? "Saved" : r.error); })}>Save mapping</Button>
          {saved && <span className="text-sm" role="status">{saved}</span>}
        </div>
      </details>
    </div>
  );
}
