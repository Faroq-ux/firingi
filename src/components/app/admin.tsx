"use client";
/** FIRINGI's phone-app settings (Phase 39, English). */
import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { saveAppSettingsAction } from "@/server/actions/app";
import { APP_PORTALS, type AppSettings } from "@/lib/app";

const PORTAL: Record<string, string> = { buy: "Customers & wholesalers buying", vendor: "Suppliers", driver: "Drivers", admin: "FIRINGI staff" };

export function AppSettingsForm({ initial, canEdit }: { initial: AppSettings; canEdit: boolean }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const num = (label: string, value: number, set: (x: number) => void, hint: string, id: string, step = 1) => (
    <div className="space-y-1"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" step={step} value={value} disabled={!canEdit} onChange={(e) => set(Number(e.target.value))} data-testid={id} /><p className="text-xs text-muted-foreground">{hint}</p></div>
  );
  return (
    <form className="space-y-6" data-testid="app-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveAppSettingsAction(v), undefined, "Saved"); }}>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">Who can install FIRINGI and use it offline</legend>
        <div className="flex flex-wrap gap-4">{APP_PORTALS.map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" disabled={!canEdit} checked={v.portals[p]} onChange={(e) => setV({ ...v, portals: { ...v.portals, [p]: e.target.checked } })} data-testid={`portal-${p}`} />{PORTAL[p]}</label>)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" disabled={!canEdit} checked={v.installPrompt} onChange={(e) => setV({ ...v, installPrompt: e.target.checked })} data-testid="install-prompt" />Offer “Install FIRINGI” (Android / computers; iPhone gets the Add-to-Home-Screen steps)</label>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Orders placed without signal</legend>
        <p className="text-sm text-muted-foreground">When an offline order reaches FIRINGI, prices and stock are checked again. Products no longer available (or not in stock) always go back to the buyer.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="ap-mode">When prices changed meanwhile</Label>
            <Select id="ap-mode" value={v.offlineOrders.mode} disabled={!canEdit} onChange={(e) => setV({ ...v, offlineOrders: { ...v.offlineOrders, mode: e.target.value as "ASK" | "AUTO" } })} data-testid="ap-mode">
              <option value="ASK">Always ask the buyer to confirm</option>
              <option value="AUTO">Place it by itself when prices moved at most the limit (ask otherwise)</option>
            </Select>
          </div>
          {num("Limit (% price change, up or down)", v.offlineOrders.maxChangePct, (x) => setV({ ...v, offlineOrders: { ...v.offlineOrders, maxChangePct: x } }), "Used when orders are placed by themselves.", "ap-maxpct", 0.5)}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Kept on the phone</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {num("Products (buyers)", v.snapshot.products, (x) => setV({ ...v, snapshot: { ...v.snapshot, products: x } }), "Usual products first, then order lists.", "ap-products")}
          {num("Recent orders", v.snapshot.orders, (x) => setV({ ...v, snapshot: { ...v.snapshot, orders: x } }), "Buyers and suppliers.", "ap-orders")}
          {num("Invoices", v.snapshot.invoices, (x) => setV({ ...v, snapshot: { ...v.snapshot, invoices: x } }), "Listed offline.", "ap-invoices")}
          {num("Invoice PDFs", v.snapshot.documents, (x) => setV({ ...v, snapshot: { ...v.snapshot, documents: x } }), "Readable offline.", "ap-docs")}
          {num("Refresh every (minutes)", v.refreshMinutes, (x) => setV({ ...v, refreshMinutes: x }), "While online.", "ap-refresh")}
        </div>
        <p className="text-xs text-muted-foreground">Saved data is removed from the phone on sign-out or when someone else signs in. Actions not sent yet are kept and only sent by the person who did them.</p>
      </fieldset>
      {canEdit && <div className="flex items-center gap-2"><Button type="submit" disabled={pending} data-testid="ap-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>}
    </form>
  );
}
