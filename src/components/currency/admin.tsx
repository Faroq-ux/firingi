"use client";
/** Multi-currency (Phase 45) — FIRINGI admin parts (English). */
import { useState } from "react";
import { Check, RefreshCw, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { ackFxEventAction, clearOverrideAction, fetchRatesAction, overrideRateAction, saveCurrencySettingsAction } from "@/server/actions/currency";
import { LOCAL_CURRENCIES, type CurrencySettings } from "@/lib/currency";

type Country = { code: string; name: string; flag: string | null; currency: string };

export function CurrencySettingsForm({ initial, countries }: { initial: CurrencySettings; countries: Country[] }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<CurrencySettings>(initial);
  const [margins, setMargins] = useState<Record<string, string>>(Object.fromEntries(LOCAL_CURRENCIES.map((c) => [c, String(initial.margins[c] ?? 0)])));
  const box = (label: string, checked: boolean, on: (v: boolean) => void, testid?: string) => (
    <label className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 shrink-0" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> <span className="min-w-0">{label}</span></label>
  );
  const num = (v: string) => Number(v.replace(",", "."));
  return (
    <div className="space-y-6" data-testid="currency-settings">
      {box("Multi-currency on (off: everything in EUR, as before)", x.enabled, (v) => setX({ ...x, enabled: v }), "cs-enabled")}
      <div className="space-y-2">
        <p className="text-sm font-medium">Countries billed in their own currency</p>
        <p className="text-xs text-muted-foreground">Customers there see prices, order, get invoices and pay in their currency; suppliers there price and are paid in it (when allowed below). Countries left off stay in EUR.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {countries.map((c) => box(`${c.flag ?? ""} ${c.name} — ${c.currency}`, !!x.countries[c.code], (v) => setX({ ...x, countries: { ...x.countries, [c.code]: v } }), `cs-country-${c.code}`))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Prices</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Show the EUR amount alongside the local one", x.showEur, (v) => setX({ ...x, showEur: v }), "cs-showEur")}
          {box("Suppliers price in their own currency (converted at the reference rate)", x.supplierCurrency, (v) => setX({ ...x, supplierCurrency: v }), "cs-supplier")}
          {box("Fixed local price lists (a price list in the customer's currency is used exactly, no FX margin)", x.localPriceLists, (v) => setX({ ...x, localPriceLists: v }), "cs-localLists")}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">FX margin on conversions for customers (%)</p>
        <p className="text-xs text-muted-foreground">Added to the reference rate when FIRINGI converts EUR prices for a customer (0–10 %). Customers see only the resulting price; suppliers never see it.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {LOCAL_CURRENCIES.map((c) => (
            <div key={c} className="min-w-0 space-y-1"><Label htmlFor={`cs-m-${c}`}>{c}</Label>
              <Input id={`cs-m-${c}`} inputMode="decimal" value={margins[c]} onChange={(e) => setMargins({ ...margins, [c]: e.target.value })} data-testid={`cs-margin-${c}`} /></div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Rates & alerts</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="cs-feed">Rates come from</Label>
            <Select id="cs-feed" value={x.feed} onChange={(e) => setX({ ...x, feed: e.target.value === "MANUAL" ? "MANUAL" : "ECB" })} data-testid="cs-feed">
              <option value="ECB">ECB daily reference rates</option><option value="MANUAL">Typed in by FIRINGI only</option>
            </Select></div>
          <div className="space-y-1"><Label htmlFor="cs-move">Alert when a rate moves more than (%)</Label><Input id="cs-move" inputMode="decimal" value={String(x.alertMovePct)} onChange={(e) => setX({ ...x, alertMovePct: num(e.target.value) || 0 })} /></div>
          <div className="space-y-1"><Label htmlFor="cs-stale">Alert when the newest rate is older than (days)</Label><Input id="cs-stale" inputMode="numeric" value={String(x.staleDays)} onChange={(e) => setX({ ...x, staleDays: Number(e.target.value.replace(/\D/g, "")) || 1 })} /></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Fetch the ECB rates every working day", x.autoFetch, (v) => setX({ ...x, autoFetch: v }), "cs-auto")}
          {box("Alert when the feed can't be read", x.alertFeedFailure, (v) => setX({ ...x, alertFeedFailure: v }), "cs-feedAlert")}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Money & accounts</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Invoices in another currency show the EUR equivalent of the VAT and totals", x.invoiceEurEquivalent, (v) => setX({ ...x, invoiceEurEquivalent: v }), "cs-eurEq")}
          {box("Suppliers' statements and payouts in their own currency", x.payoutsLocal, (v) => setX({ ...x, payoutsLocal: v }), "cs-payouts")}
          {box("Book realised exchange gains / losses when payments settle", x.fxAccounting, (v) => setX({ ...x, fxAccounting: v }), "cs-fxAcc")}
          {box("Currency switch on FIRINGI reports (books stay in EUR)", x.reportSwitch, (v) => setX({ ...x, reportSwitch: v }), "cs-reports")}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} data-testid="cs-save" onClick={() => run(() => saveCurrencySettingsAction({ ...x, alertMovePct: Math.max(0.1, x.alertMovePct), margins: Object.fromEntries(LOCAL_CURRENCIES.map((c) => [c, Math.min(10, Math.max(0, num(margins[c]) || 0))])) }), undefined, "Saved")}>
          <Spin on={pending} icon={Save} /> Save
        </Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function FetchRatesButton({ disabled }: { disabled?: boolean }) {
  const { pending, error, done, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending || disabled} data-testid="fetch-rates" onClick={() => run(() => fetchRatesAction({}), undefined, "Rates fetched")}><Spin on={pending} icon={RefreshCw} /> Fetch ECB rates now</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function RateOverrideForm({ codes }: { codes: string[] }) {
  const { pending, error, done, run } = useRun();
  const [code, setCode] = useState(codes[0] ?? "PLN");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  return (
    <form className="grid min-w-0 gap-3 sm:grid-cols-[8rem_10rem_1fr_auto] sm:items-end" data-testid="rate-override"
      onSubmit={(e) => { e.preventDefault(); run(() => overrideRateAction({ code, rate: Number(rate.replace(",", ".")), note: note || null }), () => { setRate(""); setNote(""); }, "Rate set for today"); }}>
      <div className="space-y-1"><Label htmlFor="ro-code">Currency</Label><Select id="ro-code" value={code} onChange={(e) => setCode(e.target.value)}>{codes.map((c) => <option key={c}>{c}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="ro-rate">1 EUR =</Label><Input id="ro-rate" inputMode="decimal" required value={rate} onChange={(e) => setRate(e.target.value)} data-testid="ro-rate" /></div>
      <div className="min-w-0 space-y-1"><Label htmlFor="ro-note">Why (optional)</Label><Input id="ro-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <Button type="submit" disabled={pending} data-testid="ro-save"><Spin on={pending} icon={Check} /> Set rate</Button>
      <div className="sm:col-span-4"><Msg error={error} done={done} /></div>
    </form>
  );
}

export function ClearOverrideButton({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={pending} data-testid="clear-override" onClick={() => run(() => clearOverrideAction({ id }))}><Spin on={pending} icon={Undo2} /> Back to feed</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function AckButton({ id, label = "Seen" }: { id: string; label?: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="outline" disabled={pending} data-testid={id === "ALL" ? "ack-all" : "ack"} onClick={() => run(() => ackFxEventAction({ id }))}><Spin on={pending} icon={Check} /> {label}</Button>;
}
