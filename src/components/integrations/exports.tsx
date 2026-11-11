"use client";
/** Company › Exports: pick dates and documents, download Excel / CSV. */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileSpreadsheet } from "lucide-react";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function presets() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return {
    thisMonth: [iso(new Date(Date.UTC(y, m, 1))), iso(now)],
    lastMonth: [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))],
    thisYear: [iso(new Date(Date.UTC(y, 0, 1))), iso(now)],
  } as const;
}

export function CompanyExports({ kinds }: { kinds: string[] }) {
  const t = useTranslations("integrations");
  const p = presets();
  const [from, setFrom] = useState<string>(p.thisMonth[0]);
  const [to, setTo] = useState<string>(p.thisMonth[1]);
  const [chosen, setChosen] = useState<string[]>(kinds);
  const [file, setFile] = useState<"xlsx" | "csv">("xlsx");
  const href = `/api/exports/company?from=${from}&to=${to}&kinds=${chosen.join(",")}&file=${file}`;
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]" data-testid="company-exports">
      <div className="space-y-4 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(p) as (keyof typeof p)[]).map((k) => (
            <button key={k} onClick={() => { setFrom(p[k][0]); setTo(p[k][1]); }} className={`rounded-full border px-3 py-1 text-sm transition-colors ${from === p[k][0] && to === p[k][1] ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted"}`}>{t(`exports.${k}`)}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{t("exports.from")}</span><input type="date" className="h-9 rounded-md border bg-background px-2" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="export-from" /></label>
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{t("exports.to")}</span><input type="date" className="h-9 rounded-md border bg-background px-2" value={to} onChange={(e) => setTo(e.target.value)} data-testid="export-to" /></label>
        </div>
        <fieldset className="text-sm"><legend className="mb-2 text-muted-foreground">{t("exports.what")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">{kinds.map((k) => (
            <label key={k} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${chosen.includes(k) ? "border-primary bg-primary/5" : ""}`}>
              <input type="checkbox" className="size-4" checked={chosen.includes(k)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))} data-testid={`kind-${k}`} />
              {t(`kind.${k.replace(".", "_")}`)}
            </label>
          ))}</div>
        </fieldset>
      </div>
      <div className="tile gloss tone-blue flex flex-col justify-between gap-4 rounded-2xl border p-5">
        <div className="tile-chip grid size-12 place-items-center rounded-xl motion-float"><FileSpreadsheet className="size-6" aria-hidden /></div>
        <fieldset className="text-sm"><legend className="mb-2 text-muted-foreground">{t("exports.file")}</legend>
          <div className="inline-flex rounded-lg border bg-muted/50 p-1">{(["xlsx", "csv"] as const).map((f) => <button key={f} onClick={() => setFile(f)} className={`rounded-md px-4 py-1 text-sm ${file === f ? "bg-card font-semibold shadow-sm" : "text-muted-foreground"}`}>{f === "xlsx" ? "Excel" : "CSV"}</button>)}</div>
        </fieldset>
        <a href={chosen.length && from && to ? href : undefined} aria-disabled={!chosen.length} data-variant="default" data-testid="export-download"
          className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-primary-foreground ${chosen.length ? "" : "pointer-events-none opacity-50"}`}><Download className="size-4" aria-hidden />{t("exports.download")}</a>
      </div>
    </div>
  );
}
