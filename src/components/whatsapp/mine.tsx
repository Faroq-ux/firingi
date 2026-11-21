"use client";
/** The business's own WhatsApp preferences (Phase 58) — texts come translated from the page. */
import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { Switch } from "@/components/compliance/admin";
import { saveMyWhatsAppAction } from "@/server/actions/whatsapp";

type L = { orderUpdates: string; orderUpdatesHint: string; reminders: string; remindersHint: string; save: string; saved: string };
export function MyWhatsAppForm({ initial, canEdit, hasNumber, remindersOn, labels }: { initial: { orderUpdates: boolean; reminders: boolean }; canEdit: boolean; hasNumber: boolean; remindersOn: boolean; labels: L }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const row = (id: string, label: string, hint: string, on: boolean, set: (v: boolean) => void, disabled = false) => (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
      <Switch on={on} label={label} disabled={!canEdit || disabled} onToggle={() => set(!on)} testId={id} />
    </div>
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => saveMyWhatsAppAction(s), undefined, labels.saved); }}>
      {row("wa-my-updates", labels.orderUpdates, labels.orderUpdatesHint, s.orderUpdates, (v) => setS({ ...s, orderUpdates: v }))}
      {remindersOn && row("wa-my-reminders", labels.reminders, labels.remindersHint, s.reminders, (v) => setS({ ...s, reminders: v }), !hasNumber)}
      {canEdit && <div className="flex flex-wrap items-center gap-3"><Button type="submit" size="sm" disabled={pending} data-testid="wa-my-save"><Spin on={pending} icon={Save} /> {labels.save}</Button><Msg error={error} done={done} /></div>}
    </form>
  );
}
