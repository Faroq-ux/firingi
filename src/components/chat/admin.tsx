"use client";
/** FIRINGI's order-chat controls (Phase 35, English): switches per channel, hiding, translation; flagged messages. */
import { useState } from "react";
import Link from "next/link";
import { Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { reviewFlaggedAction, saveChatSettingsAction } from "@/server/actions/chat";
import { CHANNEL_LABEL, CHAT_CHANNELS, type ChatSettings } from "@/lib/chat";
import { AI_MODEL_LABEL, AI_MODELS } from "@/lib/ai";

const TABS = [
  { href: "/admin/orders/chat", label: "Overview & settings" },
  { href: "/admin/orders/chat/flagged", label: "Flagged messages" },
];
export function ChatTabs({ active, flagged }: { active: string; flagged?: number }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Order chat">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${t.href === active ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-sm" : "bg-card hover:border-[var(--vivid-violet)]"}`}>
          {t.label}{t.href.endsWith("/flagged") && flagged ? <span className="ml-1.5 rounded-full bg-[var(--vivid-pink,#db2777)] px-1.5 text-xs text-white">{flagged}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

const CHANNEL_HINT: Record<(typeof CHAT_CHANNELS)[number], string> = {
  BUYER_SUPPLIER: "Customer and supplier talk directly (not on orders FIRINGI routed — there the supplier stays hidden). FIRINGI reads along.",
  BUYER_FIRINGI: "Customer and FIRINGI support.",
  SUPPLIER_FIRINGI: "Supplier and FIRINGI — never shown to the customer.",
  DRIVER: "The driver, the customer and whoever runs the delivery (the supplier for its own fleet, otherwise FIRINGI). Open only while the delivery is on the road.",
};

export function ChatSettingsForm({ settings, canManage, translation }: { settings: ChatSettings; canManage: boolean; translation: string }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const box = "flex items-start gap-2 text-sm";
  return (
    <form className="space-y-4" data-testid="chat-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveChatSettingsAction(v), undefined, "Saved"); }}>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={v.enabled} disabled={!canManage} onChange={(e) => setV({ ...v, enabled: e.target.checked })} data-testid="chat-enabled" /> Order chat on</label>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Who can talk on an order</legend>
        {CHAT_CHANNELS.map((c) => (
          <label key={c} className={`${box} rounded-xl border p-3`}>
            <input type="checkbox" className="mt-1" checked={v.channels[c]} disabled={!canManage} onChange={(e) => setV({ ...v, channels: { ...v.channels, [c]: e.target.checked } })} data-testid={`chat-channel-${c}`} />
            <span><span className="font-medium">{CHANNEL_LABEL[c]}</span><span className="block text-xs text-muted-foreground">{CHANNEL_HINT[c]}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={box}><input type="checkbox" className="mt-1" checked={v.maskContacts} disabled={!canManage} onChange={(e) => setV({ ...v, maskContacts: e.target.checked })} data-testid="chat-mask" />
          <span><span className="font-medium">Hide contact details</span><span className="block text-xs text-muted-foreground">Phone numbers, e-mails, IBANs and links become [•••]; the sender is warned and the message is flagged here. Switch it off for one company under Business Features.</span></span></label>
        <label className={box}><input type="checkbox" className="mt-1" checked={v.translate} disabled={!canManage} onChange={(e) => setV({ ...v, translate: e.target.checked })} data-testid="chat-translate" />
          <span><span className="font-medium">Translate messages with AI</span><span className="block text-xs text-muted-foreground">Each reader sees messages in their own language, with “show original”. {translation === "no-key" ? "No AI key is set — messages show as written until one is." : translation === "simulated" ? "Simulated translator (test mode)." : "AI key set."}</span></span></label>
        <label className={box}><input type="checkbox" className="mt-1" checked={v.photos} disabled={!canManage} onChange={(e) => setV({ ...v, photos: e.target.checked })} />
          <span><span className="font-medium">Photos in messages</span><span className="block text-xs text-muted-foreground">Up to 3 per message (JPG, PNG, WEBP).</span></span></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="chat-model">Translation model</Label>
          <select id="chat-model" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.translateModel} disabled={!canManage} onChange={(e) => setV({ ...v, translateModel: e.target.value as ChatSettings["translateModel"] })}>
            {AI_MODELS.map((m) => <option key={m} value={m}>{AI_MODEL_LABEL[m]}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="chat-driver-hours">Driver chat stays open after delivery (hours)</Label><Input id="chat-driver-hours" type="number" min={0} max={72} value={String(v.driverHoursAfter)} disabled={!canManage} onChange={(e) => setV({ ...v, driverHoursAfter: Number(e.target.value) })} /></div>
        <div className="space-y-1"><Label htmlFor="chat-close-days">Read-only after the order ends (days)</Label><Input id="chat-close-days" type="number" min={1} max={365} value={String(v.closeDaysAfter)} disabled={!canManage} onChange={(e) => setV({ ...v, closeDaysAfter: Number(e.target.value) })} /></div>
      </div>
      {canManage && <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="chat-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>}
    </form>
  );
}

export function ReviewFlagButton({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewFlaggedAction({ id }))} data-testid="flag-review"><Check className="size-4" /> Reviewed</Button>
      <Msg error={error} />
    </span>
  );
}
