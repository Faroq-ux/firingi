"use client";
/** WhatsApp ordering (Phase 58) — FIRINGI's interactive parts (English). */
import { useState } from "react";
import { Pause, Play, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { Switch } from "@/components/compliance/admin";
import { pauseWaConversationAction, saveSmallOrderSettingsAction, saveWaSettingsAction, setCompanySmallOrdersAction, setCompanyWhatsAppAction } from "@/server/actions/whatsapp";
import type { WaSettings } from "@/lib/wa-ordering";

function Row({ id, label, hint, on, set }: { id: string; label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="min-w-0"><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      <Switch on={on} label={label} onToggle={() => set(!on)} testId={id} />
    </div>
  );
}
const Num = ({ id, label, value, set, min, max }: { id: string; label: string; value: number; set: (v: number) => void; min: number; max: number }) => (
  <div className="grid gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} data-testid={id} type="number" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} /></div>
);

export function WaSettingsForm({ initial }: { initial: WaSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof WaSettings>(k: K, v: WaSettings[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-5" data-testid="wa-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveWaSettingsAction(s), undefined, "Saved."); }}>
      <section className="grid gap-3 sm:grid-cols-2">
        <Row id="wa-enabled" label="WhatsApp ordering on" hint="Off: the AI answers no WhatsApp message (the inbox still receives them)" on={s.enabled} set={(v) => set("enabled", v)} />
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Who can order by WhatsApp</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Row id="wa-aud-customers" label="Wholesale customers" hint="Shops, cafés, restaurants" on={s.audiences.customers} set={(v) => set("audiences", { ...s.audiences, customers: v })} />
          <Row id="wa-aud-wholesalers" label="Wholesalers" hint="Restocking from distributors" on={s.audiences.wholesalers} set={(v) => set("audiences", { ...s.audiences, wholesalers: v })} />
          <Row id="wa-aud-unknown" label="Unknown numbers" hint="Get the registration link (once a day)" on={s.audiences.unknownNumbers} set={(v) => set("audiences", { ...s.audiences, unknownNumbers: v })} />
        </div>
        <p className="text-xs text-muted-foreground">A single business can also be switched off below.</p>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">What the AI understands and sends</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Row id="wa-in-photos" label="Photos" hint="A shopping list or a product" on={s.inputs.photos} set={(v) => set("inputs", { ...s.inputs, photos: v })} />
          <Row id="wa-in-voice" label="Voice notes" hint="Needs speech-to-text (STT_URL)" on={s.inputs.voice} set={(v) => set("inputs", { ...s.inputs, voice: v })} />
          <Row id="wa-in-buttons" label="Buttons" hint="Yes / Cancel / Repeat (Meta Cloud API)" on={s.inputs.buttons} set={(v) => set("inputs", { ...s.inputs, buttons: v })} />
          <Row id="wa-updates" label="Order updates" hint="Confirmed, on its way, delivered, cancelled" on={s.orderUpdates} set={(v) => set("orderUpdates", v)} />
          <Row id="wa-paylinks" label="Payment links" hint="Pay-before-delivery orders and open invoices" on={s.payLinks} set={(v) => set("payLinks", v)} />
          <Row id="wa-reminders" label="Reorder reminders" hint="Only to businesses that said yes" on={s.reminders.enabled} set={(v) => set("reminders", { ...s.reminders, enabled: v })} />
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Num id="wa-draft" label="Proposal waits for YES (minutes)" value={s.draftMinutes} set={(v) => set("draftMinutes", v)} min={10} max={1440} />
        <Num id="wa-pause" label="AI quiet after hand-over (hours)" value={s.pauseHours} set={(v) => set("pauseHours", v)} min={1} max={168} />
        <Num id="wa-hourly" label="Messages per business per hour" value={s.hourlyLimit} set={(v) => set("hourlyLimit", v)} min={1} max={500} />
        <Num id="wa-days" label="Remind days before usual reorder" value={s.reminders.daysBefore} set={(v) => set("reminders", { ...s.reminders, daysBefore: v })} min={0} max={7} />
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Templates (messages outside the 24-hour window)</h3>
        <p className="text-xs text-muted-foreground">WhatsApp only allows free text within 24 hours of the customer&apos;s last message. Later updates and reminders use approved templates — leave empty to skip them.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1"><Label htmlFor="wa-tpl-update">Order update template</Label><Input id="wa-tpl-update" value={s.templates.orderUpdate} placeholder="order_update" onChange={(e) => set("templates", { ...s.templates, orderUpdate: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="wa-tpl-reminder">Reminder template</Label><Input id="wa-tpl-reminder" value={s.templates.reminder} placeholder="reorder_reminder" onChange={(e) => set("templates", { ...s.templates, reminder: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="wa-tpl-lang">Template language</Label><Input id="wa-tpl-lang" value={s.templates.language} onChange={(e) => set("templates", { ...s.templates, language: e.target.value })} /></div>
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="wa-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function SmallOrdersForm({ initial }: { initial: { enabled: boolean; perMonth: number } }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  return (
    <form className="space-y-3" data-testid="small-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveSmallOrderSettingsAction(s), undefined, "Saved."); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Row id="small-enabled" label="Limit small orders per month" hint="Website, app and WhatsApp" on={s.enabled} set={(v) => setS({ ...s, enabled: v })} />
        <Num id="small-per-month" label="Small orders per customer per month" value={s.perMonth} set={(v) => setS({ ...s, perMonth: v })} min={0} max={100} />
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="small-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

/** Per business: WhatsApp on/off and its own small-order limit (empty = general, or unlimited). */
export function BusinessControls({ id, type, whatsappOn, perMonth, unlimited }: { id: string; type: string; whatsappOn: boolean; perMonth: number | null; unlimited: boolean }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState(perMonth == null ? "" : String(perMonth));
  const [u, setU] = useState(unlimited);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch on={whatsappOn} label="WhatsApp ordering" disabled={pending} onToggle={() => run(() => setCompanyWhatsAppAction({ companyId: id, enabled: !whatsappOn }))} testId={`wa-co-${id}`} />
      {type === "CUSTOMER" && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setCompanySmallOrdersAction({ companyId: id, perMonth: v.trim() === "" ? null : Number(v), unlimited: u })); }}>
          <Input aria-label="Own limit" className="h-8 w-24" type="number" min={0} max={100} placeholder="general" value={v} disabled={u} onChange={(e) => setV(e.target.value)} data-testid={`small-co-${id}`} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={u} onChange={(e) => setU(e.target.checked)} data-testid={`small-unl-${id}`} /> No limit</label>
          <Button size="sm" variant="outline" type="submit" disabled={pending} data-testid={`small-co-save-${id}`}><Spin on={pending} icon={Save} /></Button>
        </form>
      )}
      <Msg error={error} />
    </div>
  );
}

export function PauseButton({ id, paused }: { id: string; paused: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} data-testid={`wa-pause-${id}`} onClick={() => run(() => pauseWaConversationAction({ conversationId: id, pause: !paused }))}>
        <Spin on={pending} icon={paused ? Play : Pause} /> {paused ? "Give back to AI" : "Take over"}
      </Button>
      <Msg error={error} />
    </span>
  );
}
