"use client";
/** Supplier: upload a price / stock file → match its columns → preview run (then the run page applies). */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, Loader2, UploadCloud, Download, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Steps } from "./hero";
import { inspectImportAction, previewUploadAction } from "@/server/actions/integrations";

const FIELDS = ["vendor_sku", "gtin", "price", "stock", "warehouse", "min_qty", "qty_step", "lead_days", "active", "name"] as const;
type Inspect = { fileName: string; headers: string[]; sample: string[][]; total: number; mapping: Record<string, string> };

export function ImportWizard() {
  const t = useTranslations("integrations");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<Inspect | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saveAs, setSaveAs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [pending, start] = useTransition();

  const read = (f: File) => {
    setFile(f); setError(null);
    start(async () => {
      const fd = new FormData(); fd.set("file", f);
      const r = await inspectImportAction(fd);
      if (!r.ok) { setError(r.error); setInfo(null); return; }
      setInfo(r.data); setMapping(r.data.mapping);
    });
  };
  const preview = () => start(async () => {
    if (!file) return;
    const fd = new FormData(); fd.set("file", file); fd.set("mapping", JSON.stringify(mapping)); if (saveAs.trim()) fd.set("saveAs", saveAs.trim());
    const r = await previewUploadAction(fd);
    if (!r.ok) return setError(r.error);
    router.push(`/vendor/products/import/${r.data.runId}`);
  });
  const setField = (col: string, f: string) => setMapping((m) => {
    const next = { ...m };
    if (f) for (const k of Object.keys(next)) if (next[k] === f) next[k] = ""; // each field once
    next[col] = f;
    return next;
  });
  const steps = [t("import.steps.upload"), t("import.steps.match"), t("import.steps.check"), t("import.steps.apply")];

  return (
    <div data-testid="import-wizard">
      <Steps steps={steps} current={info ? 1 : 0} />
      {!info ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) read(f); }}
            className={`group relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-all ${drag ? "scale-[1.01] border-primary bg-primary/10" : "border-[color:color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[linear-gradient(160deg,color-mix(in_oklch,var(--vivid-blue)_10%,var(--card)),var(--card)_60%)] hover:border-primary"}`}
          >
            <span className="tile-chip grid size-16 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-lg motion-float">
              {pending ? <Loader2 className="size-7 animate-spin" aria-hidden /> : <UploadCloud className="size-7" aria-hidden />}
            </span>
            <span className="text-lg font-semibold">{pending ? t("import.reading") : t("import.drop")}</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground gloss">{t("import.choose")}</span>
            <span className="text-xs text-muted-foreground">{t("import.limits")}</span>
            <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" data-testid="import-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
          </label>
          <div className="tile gloss tone-teal flex flex-col justify-between gap-3 rounded-2xl border p-5">
            <div>
              <div className="tile-chip mb-3 grid size-11 place-items-center rounded-xl"><FileSpreadsheet className="size-5" aria-hidden /></div>
              <p className="font-semibold">{t("import.template")}</p>
              <p className="text-sm text-muted-foreground">{t("import.templateHint")}</p>
            </div>
            <div className="flex gap-2">
              <a className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted" href="/api/imports/template?file=xlsx" data-testid="template-xlsx"><Download className="size-4" aria-hidden />Excel</a>
              <a className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted" href="/api/imports/template?file=csv"><Download className="size-4" aria-hidden />CSV</a>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("import.mapTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("import.mapHint")}</p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-sm" data-testid="rows-found">{t("import.rowsFound", { count: info.total, file: info.fileName })}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {info.headers.map((h, i) => (
              <div key={`${h}-${i}`} className={`motion-rise rounded-xl border p-3 transition-colors ${mapping[h] ? "border-[color:color-mix(in_oklch,var(--vivid-teal)_55%,var(--border))] bg-[color:color-mix(in_oklch,var(--vivid-teal)_7%,var(--card))]" : "bg-card"}`} style={{ ["--i" as string]: i }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm font-semibold" title={h}>{h || "—"}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <select className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={mapping[h] ?? ""} onChange={(e) => setField(h, e.target.value)} data-testid={`map-${i}`} aria-label={h}>
                    <option value="">{t("import.ignore")}</option>
                    {FIELDS.map((f) => <option key={f} value={f}>{t(`fields.${f}`)}</option>)}
                  </select>
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">{info.sample.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" · ") || "—"}</p>
              </div>
            ))}
          </div>
          <details className="rounded-xl border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("import.sample")}</summary>
            <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead><tr>{info.headers.map((h, i) => <th key={i} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{info.sample.map((r, j) => <tr key={j} className="border-t">{info.headers.map((_, i) => <td key={i} className="px-2 py-1 whitespace-nowrap">{r[i]}</td>)}</tr>)}</tbody></table></div>
          </details>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t("import.saveAs")}</span>
              <Input value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder={t("import.saveAsPlaceholder")} className="w-64" maxLength={80} data-testid="save-as" />
            </label>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={pending} onClick={() => { setInfo(null); setFile(null); }}>{t("import.back")}</Button>
              <Button disabled={pending} onClick={preview} data-testid="import-preview">{pending && <Loader2 className="size-4 animate-spin" aria-hidden />}{t("import.preview")}</Button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="import-error">{error}</p>}
    </div>
  );
}
