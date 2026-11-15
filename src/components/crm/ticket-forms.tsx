"use client";
/** Support ticket forms — used by companies (translated labels) and FIRINGI staff (English). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { openTicketAction, replyTicketAction } from "@/server/actions/crm";
import { MicButton, appendSpoken } from "@/components/voice/voice";
import { EN_VOICE } from "@/lib/voice";

type L = Record<string, string>;

export function NewTicketForm({ l, categories, orders, base }: { l: L; categories: { value: string; label: string }[]; orders: { id: string; label: string }[]; base: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ subject: "", category: "ORDER", orderId: "", body: "" });
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2" data-testid="new-ticket">
      <label className="space-y-1"><span className="block text-xs text-muted-foreground">{l.category}</span>
        <Select name="category" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
      </label>
      <label className="space-y-1"><span className="block text-xs text-muted-foreground">{l.order}</span>
        <Select name="orderId" value={v.orderId} onChange={(e) => setV({ ...v, orderId: e.target.value })}><option value="">{l.noOrder}</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
      </label>
      <label className="space-y-1 sm:col-span-2"><span className="block text-xs text-muted-foreground">{l.subject}</span><Input name="subject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></label>
      <label className="space-y-1 sm:col-span-2"><span className="block text-xs text-muted-foreground">{l.message}</span>
        <span className="flex items-start gap-2">
          <textarea name="body" className="min-h-28 w-full rounded-md border bg-background p-2" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          <MicButton onText={(s) => setV((x) => ({ ...x, body: appendSpoken(x.body, s) }))} testId="ticket-mic" />
        </span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button disabled={pending} onClick={() => start(async () => {
          setError(null);
          const r = await openTicketAction({ subject: v.subject, body: v.body, category: v.category as "ORDER", orderId: v.orderId || null });
          if (r.ok) router.push(`${base}/${r.data.id}?sent=1`); else setError(r.error);
        })}>{l.send}</Button>
        {error && <span className="text-destructive" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/** Reply box: companies write to FIRINGI; staff can also write an internal note or resolve. */
export function ReplyForm({ id, l, staff }: { id: string; l: L; staff?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const send = (resolve = false) => start(async () => {
    setError(null);
    const r = await replyTicketAction({ id, body, internal: staff ? internal : false, resolve });
    if (r.ok) { setBody(""); setInternal(false); router.refresh(); } else setError(r.error);
  });
  return (
    <div className="space-y-2 text-sm" data-testid="reply-form">
      <div className="flex items-start gap-2">
        <textarea name="reply" aria-label={l.reply} placeholder={l.replyPlaceholder} className={`min-h-24 w-full rounded-md border p-2 ${internal ? "bg-warning/10" : "bg-background"}`} value={body} onChange={(e) => setBody(e.target.value)} />
        <MicButton onText={(s) => setBody((b) => appendSpoken(b, s))} labels={staff ? EN_VOICE : undefined} testId="reply-mic" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !body.trim()} onClick={() => send(false)}>{internal ? l.addNote : l.send}</Button>
        {staff && !internal && <Button variant="outline" disabled={pending || !body.trim()} onClick={() => send(true)}>{l.sendResolve}</Button>}
        {staff && <label className="flex items-center gap-1.5"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> {l.internal}</label>}
        {error && <span className="text-destructive" role="alert">{error}</span>}
      </div>
    </div>
  );
}
