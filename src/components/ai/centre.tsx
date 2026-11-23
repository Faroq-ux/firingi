"use client";
/** AI Centre (Phase 66) — FIRINGI's settings form and the report generator (English: back office). */
import { useState } from "react";
import { FileText, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { generateReportAction, saveAiCentreSettingsAction } from "@/server/actions/ai";
import { AREA_LABEL, FORECAST_LABEL, FORECASTS, FUEL_KINDS, FUEL_UNIT, REC_AREAS, REPORT_LABEL, REPORTS, type AiCentreSettings, type FuelKind, type ReportKind } from "@/lib/ai-centre";

const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const Box = ({ checked, onChange, children, testid }: { checked: boolean; onChange: (b: boolean) => void; children: React.ReactNode; testid?: string }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /> {children}</label>
);

export function AiCentreSettingsForm({ settings, canSave }: { settings: AiCentreSettings; canSave: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const num = (k: "routeMinKm" | "routeMinPct" | "mergeWithinKm" | "lapseFactor" | "overdueDays", label: string, step = "1") => (
    <div className="w-full space-y-1 sm:w-48"><Label htmlFor={`aic-${k}`}>{label}</Label><Input id={`aic-${k}`} type="number" step={step} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} data-testid={`aic-${k}`} /></div>
  );
  const fuel = (k: FuelKind, f: "per100" | "price" | "co2", n: number) => setV({ ...v, fuels: { ...v.fuels, [k]: { ...v.fuels[k], [f]: n } } });
  return (
    <fieldset disabled={!canSave} className="space-y-5" data-testid="aic-settings">
      <div className="space-y-2"><p className="text-sm font-medium">Recommendation areas</p>
        <div className="flex flex-wrap gap-4">{REC_AREAS.map((a) => <Box key={a} checked={v.areas[a]} onChange={(b) => setV({ ...v, areas: { ...v.areas, [a]: b } })} testid={`aic-area-${a}`}>{AREA_LABEL[a]}</Box>)}</div></div>
      <div className="space-y-2"><p className="text-sm font-medium">Forecasts</p>
        <div className="flex flex-wrap gap-4">{FORECASTS.map((a) => <Box key={a} checked={v.forecasts[a]} onChange={(b) => setV({ ...v, forecasts: { ...v.forecasts, [a]: b } })}>{FORECAST_LABEL[a]}</Box>)}</div></div>
      <div className="space-y-2"><p className="text-sm font-medium">Reports</p>
        <div className="flex flex-wrap gap-4">{REPORTS.map((a) => <Box key={a} checked={v.reports[a]} onChange={(b) => setV({ ...v, reports: { ...v.reports, [a]: b } })}>{REPORT_LABEL[a]}</Box>)}</div>
        <Box checked={v.weeklyEmail} onChange={(b) => setV({ ...v, weeklyEmail: b })} testid="aic-weekly">Email the weekly executive report to FIRINGI admins (Monday morning)</Box>
        <Box checked={v.claudeSummaries} onChange={(b) => setV({ ...v, claudeSummaries: b })}>Let Claude write report summaries when the AI is connected</Box></div>
      <div className="space-y-2"><p className="text-sm font-medium">Thresholds</p>
        <div className="flex flex-wrap gap-4">
          {num("routeMinKm", "Route saving: at least (km)", "0.5")}{num("routeMinPct", "and at least (% of the route)")}{num("mergeWithinKm", "Combine routes within (km)")}
          {num("lapseFactor", "Customer going quiet: × usual gap", "0.1")}{num("overdueDays", "Overdue after (days)")}
        </div></div>
      <div className="space-y-2"><p className="text-sm font-medium">Fuel &amp; energy (for route savings)</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm" data-testid="aic-fuels">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Fuel</th><th className="px-2">Use per 100 km</th><th className="px-2">Price (€ per L / kWh)</th><th className="px-2">kg CO₂ per L / kWh</th></tr></thead>
            <tbody>{FUEL_KINDS.map((k) => (
              <tr key={k}><td className="py-1 pr-2">{k.toLowerCase()} <span className="text-xs text-muted-foreground">({FUEL_UNIT[k]})</span></td>
                {(["per100", "price", "co2"] as const).map((f) => <td key={f} className="px-2"><Input type="number" step="0.01" aria-label={`${k} ${f}`} value={v.fuels[k][f]} onChange={(e) => fuel(k, f, Number(e.target.value))} /></td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <div className="w-full space-y-1 sm:w-56"><Label htmlFor="aic-fuel">Vehicles without a fuel set</Label>
          <select id="aic-fuel" className={sel} value={v.defaultFuel} onChange={(e) => setV({ ...v, defaultFuel: e.target.value as FuelKind })}>{FUEL_KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}</select></div>
      </div>
      {canSave && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending} onClick={() => run(() => saveAiCentreSettingsAction(v), undefined, "Saved")} data-testid="aic-save"><Spin on={pending} icon={Save} /> Save AI Centre settings</Button>
          <Msg error={error} done={done} />
        </div>
      )}
    </fieldset>
  );
}

export function GenerateReport({ kind, claudeOn, days }: { kind: ReportKind; claudeOn: boolean; days: number }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => generateReportAction({ kind, days }))} data-testid="air-generate"><Spin on={pending} icon={FileText} /> Make it again</Button>
      {claudeOn && <Button size="sm" disabled={pending} onClick={() => run(() => generateReportAction({ kind, days, claude: true }))} data-testid="air-claude"><Spin on={pending} icon={Sparkles} /> Summary by Claude</Button>}
      <Msg error={error} />
    </span>
  );
}
