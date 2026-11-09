"use client";
/** Back-office notification forms (English, FIRINGI staff). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  markHandledAction, replyAction, resetTemplateAction, retryMessageAction, runOutboxAction, saveTemplateAction, setChannelEnabledAction, setEventChannelsAction, testSendAction,
} from "@/server/actions/notifications";
import type { ActionResult } from "@/server/actions/_action";

type Ch = "EMAIL" | "SMS" | "WHATSAPP" | "PUSH";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, okText?: (d: unknown) => string) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.ok) { if (okText) setMsg({ ok: true, text: okText(r.data) }); router.refresh(); } else setMsg({ ok: false, text: r.error });
    });
  return { pending, msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <span className={`text-xs ${m.ok ? "text-success" : "text-destructive"}`}>{m.text}</span> : null);

export function RetryButton({ id }: { id: string }) {
  const { pending, msg, run } = useAct();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryMessageAction({ id }), (d) => String(d))}>Retry</Button><Msg m={msg} /></span>;
}

export function RunOutboxButton() {
  const { pending, msg, run } = useAct();
  return <span className="inline-flex items-center gap-2"><Button variant="outline" disabled={pending} onClick={() => run(() => runOutboxAction({}), (d) => { const x = d as { processed: number; sent: number }; return `${x.sent}/${x.processed} sent`; })}>Retry due messages now</Button><Msg m={msg} /></span>;
}

export function ChannelSwitch({ channel, enabled, canEdit }: { channel: Ch; enabled: boolean; canEdit: boolean }) {
  const { pending, msg, run } = useAct();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={`channel-${channel}`} disabled={!canEdit || pending} checked={enabled} onChange={(e) => run(() => setChannelEnabledAction({ channel, enabled: e.target.checked }))} />
      {enabled ? "On for the whole platform" : "Off for the whole platform"} <Msg m={msg} />
    </label>
  );
}

export function TestSendForm({ channel }: { channel: Ch }) {
  const { pending, msg, run } = useAct();
  const [to, setTo] = useState("");
  const [text, setText] = useState("FIRINGI test message");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label>{channel === "EMAIL" ? "E-mail address" : "Mobile number (+country code)"}</Label><Input name="testTo" value={to} onChange={(e) => setTo(e.target.value)} className="w-64" /></div>
      <div className="space-y-1"><Label>Text</Label><Input name="testText" value={text} onChange={(e) => setText(e.target.value)} className="w-72" /></div>
      <Button disabled={pending || !to.trim()} onClick={() => run(() => testSendAction({ channel, to, text }), (d) => `Result: ${String(d)}`)}>Send test</Button>
      <Msg m={msg} />
    </div>
  );
}

export function EventChannelsForm({ eventKey, current, defaults, overridden }: { eventKey: string; current: Ch[]; defaults: Ch[]; overridden: boolean }) {
  const { pending, msg, run } = useAct();
  const [sel, setSel] = useState<Ch[]>(current);
  const all: Ch[] = ["EMAIL", "SMS", "WHATSAPP", "PUSH"];
  const changed = JSON.stringify([...sel].sort()) !== JSON.stringify([...current].sort());
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {all.map((c) => (
        <label key={c} className="flex items-center gap-1 text-xs">
          <input type="checkbox" name={`${eventKey}-${c}`} checked={sel.includes(c)} onChange={(e) => setSel(e.target.checked ? [...sel, c] : sel.filter((x) => x !== c))} />{c === "WHATSAPP" ? "WhatsApp" : c === "PUSH" ? "Push" : c === "EMAIL" ? "E-mail" : "SMS"}
        </label>
      ))}
      {changed && <Button size="sm" disabled={pending} onClick={() => run(() => setEventChannelsAction({ eventKey, channels: sel }))}>Save</Button>}
      {overridden && !changed && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setSel(defaults); run(() => setEventChannelsAction({ eventKey, channels: null })); }}>Default</Button>}
      <Msg m={msg} />
    </span>
  );
}

export function TemplateForm(props: {
  eventKey: string; channel: string; locale: string; vars: string[]; hasOverride: boolean;
  subject: string; body: string; waTemplateName: string; waLanguage: string; isActive: boolean;
}) {
  const { pending, msg, run } = useAct();
  const [f, setF] = useState({ subject: props.subject, body: props.body, waTemplateName: props.waTemplateName, waLanguage: props.waLanguage, isActive: props.isActive });
  const showSubject = props.channel === "EMAIL" || props.channel === "IN_APP" || props.channel === "PUSH";
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Placeholders: {props.vars.length ? props.vars.map((v) => `{${v}}`).join(" ") : "none"}</p>
      {showSubject && <div className="space-y-1"><Label>Title / subject</Label><Input name="tplSubject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>}
      <div className="space-y-1"><Label>Message</Label><textarea name="tplBody" className="h-28 w-full rounded-md border border-input bg-background p-2 text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
      {props.channel === "WHATSAPP" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Approved template name (Meta) / Content SID (Twilio)</Label><Input value={f.waTemplateName} onChange={(e) => setF({ ...f, waTemplateName: e.target.value })} /></div>
          <div className="space-y-1"><Label>Template language code (e.g. pt_PT)</Label><Input value={f.waLanguage} onChange={(e) => setF({ ...f, waLanguage: e.target.value })} /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">WhatsApp only delivers business-initiated messages that use a template approved by Meta. Its body parameters are filled with the placeholders above, in that order.</p>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Use this text (off = default text)</label>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={() => run(() => saveTemplateAction({ eventKey: props.eventKey, channel: props.channel as never, locale: props.locale, ...f }), () => "Saved.")}>Save</Button>
        {props.hasOverride && <Button variant="ghost" disabled={pending} onClick={() => run(() => resetTemplateAction({ eventKey: props.eventKey, channel: props.channel as never, locale: props.locale }), () => "Back to the default text.")}>Reset to default</Button>}
        <Msg m={msg} />
      </div>
    </div>
  );
}

export function ReplyForm({ from, defaultChannel, whatsappOpen }: { from: string; defaultChannel: "SMS" | "WHATSAPP"; whatsappOpen: boolean }) {
  const { pending, msg, run } = useAct();
  const [channel, setChannel] = useState<"SMS" | "WHATSAPP">(defaultChannel === "WHATSAPP" && !whatsappOpen ? "SMS" : defaultChannel);
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <textarea name="replyText" className="h-20 w-full rounded-md border border-input bg-background p-2 text-sm" placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={channel} onChange={(e) => setChannel(e.target.value as never)}>
          <option value="WHATSAPP" disabled={!whatsappOpen}>WhatsApp{whatsappOpen ? "" : " (24 h window closed)"}</option>
          <option value="SMS">SMS</option>
        </select>
        <Button disabled={pending || !text.trim()} onClick={() => run(() => replyAction({ from, channel, text }), () => { setText(""); return "Sent."; })}>Send reply</Button>
        <Button variant="ghost" disabled={pending} onClick={() => run(() => markHandledAction({ from }), () => "Marked as handled.")}>Mark handled</Button>
        <Msg m={msg} />
      </div>
    </div>
  );
}
