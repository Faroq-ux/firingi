/** Back-office notification views (English). */
import Link from "next/link";
import type { MessageStatus, NotificationChannel } from "@prisma/client";
import { getLocale } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { UI_LOCALES } from "@/i18n/config";
import { EVENTS } from "@/server/notify/events";
import { channelsOverview, conversation, eventSettings, inbox, listMessages, listOverrides, messageStats, templateEditor, type Audience } from "@/server/services/notifications";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { ChannelSwitch, EventChannelsForm, ReplyForm, RetryButton, RunOutboxButton, TemplateForm, TestSendForm } from "./notifications-admin-forms";

const S_VARIANT: Record<MessageStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = { QUEUED: "warning", SENT: "default", DELIVERED: "success", READ: "success", FAILED: "destructive", SKIPPED: "secondary" };
const CH_LABEL: Record<NotificationChannel, string> = { IN_APP: "In app", EMAIL: "E-mail", SMS: "SMS", WHATSAPP: "WhatsApp", PUSH: "Push" };

async function MessagesTable({ ctx, channel, status, eventKey, q, take }: { ctx: Ctx; channel?: NotificationChannel; status?: MessageStatus; eventKey?: string; q?: string; take?: number }) {
  const [rows, locale] = await Promise.all([listMessages(ctx, { channel, status, eventKey, q, take }), getLocale()]);
  const manage = can(ctx, "admin.notifications.manage");
  return (
    <Table>
      <THead><TR><TH>When</TH><TH>Event</TH><TH>Channel</TH><TH>To</TH><TH>Subject / text</TH><TH>Status</TH><TH /></TR></THead>
      <TBody>
        {rows.length === 0 && <EmptyRow colSpan={7}>No messages.</EmptyRow>}
        {rows.map((m) => (
          <TR key={m.id}>
            <TD className="whitespace-nowrap text-xs">{formatDate(m.createdAt, locale, true)}</TD>
            <TD className="font-mono text-xs">{m.eventKey}</TD>
            <TD className="text-xs">{CH_LABEL[m.channel]} <span className="text-muted-foreground">· {m.provider}</span></TD>
            <TD className="max-w-48 truncate text-xs">{m.user?.name ? `${m.user.name} · ` : ""}{m.to}</TD>
            <TD className="max-w-72 text-xs"><div className="truncate font-medium">{m.subject}</div><div className="line-clamp-1 text-muted-foreground">{m.body}</div></TD>
            <TD className="text-xs"><Badge variant={S_VARIANT[m.status]}>{m.status.toLowerCase()}</Badge>{m.attempts > 1 ? ` ×${m.attempts}` : ""}{m.error && <div className="max-w-48 truncate text-destructive" title={m.error}>{m.error}</div>}</TD>
            <TD>{manage && m.status === "FAILED" && <RetryButton id={m.id} />}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export async function MessageLog({ ctx, sp }: { ctx: Ctx; sp: { channel?: string; status?: string; event?: string; q?: string } }) {
  const stats = await messageStats(ctx);
  const channel = sp.channel as NotificationChannel | undefined, status = sp.status as MessageStatus | undefined;
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ channel, status, event: sp.event, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const sum = (c: string, s?: string) => stats.filter((x) => x.channel === c && (!s || x.status === s)).reduce((a, x) => a + x.n, 0);
  return (
    <>
      <PageHeader title="Notifications" description="Every e-mail, SMS, WhatsApp and push message FIRINGI sent (last 200 shown). Skipped = the person can't be reached on that channel (no number, no consent)." actions={can(ctx, "admin.notifications.manage") ? <RunOutboxButton /> : undefined} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["EMAIL", "SMS", "WHATSAPP", "PUSH"] as const).map((c) => (
          <Link key={c} href={q({ channel: c })} className={`rounded-lg border bg-card p-3 hover:shadow-sm ${channel === c ? "ring-2 ring-primary" : ""}`}>
            <div className="text-xs text-muted-foreground">{CH_LABEL[c]} · 7 days</div>
            <div className="text-2xl font-semibold tabular-nums">{sum(c)}</div>
            <div className="text-xs"><span className="text-success">{sum(c, "SENT") + sum(c, "DELIVERED") + sum(c, "READ")} sent</span> · <span className="text-destructive">{sum(c, "FAILED")} failed</span> · {sum(c, "SKIPPED")} skipped</div>
          </Link>
        ))}
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        {channel && <input type="hidden" name="channel" value={channel} />}
        <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border bg-card px-2"><option value="">All statuses</option>{["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
        <select name="event" defaultValue={sp.event ?? ""} className="h-9 rounded-md border bg-card px-2"><option value="">All events</option>{EVENTS.map((e) => <option key={e.key} value={e.key}>{e.key}</option>)}</select>
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Recipient or subject" className="h-9 rounded-md border bg-card px-2" />
        <button className="h-9 rounded-md border px-3 hover:bg-accent">Filter</button>
        {(channel || status || sp.event || sp.q) && <Link href="?" className="text-primary hover:underline">Clear</Link>}
      </form>
      <Card><CardContent className="pt-5"><MessagesTable ctx={ctx} channel={channel} status={status} eventKey={sp.event || undefined} q={sp.q || undefined} /></CardContent></Card>
    </>
  );
}

const SETUP: Record<"EMAIL" | "SMS" | "WHATSAPP" | "PUSH", string[]> = {
  EMAIL: ["MAIL_DRIVER=smtp", "SMTP_URL=smtp://user:password@smtp.provider:587", "MAIL_FROM=\"FIRINGI <no-reply@firingi.pt>\""],
  SMS: ["SMS_DRIVER=twilio", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM=+351…", "Status + inbound webhook: <APP_URL>/api/webhooks/twilio (TWILIO_WEBHOOK_URL)"],
  WHATSAPP: ["WHATSAPP_DRIVER=meta (WhatsApp Cloud API) or twilio", "meta: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN", "Webhook: <APP_URL>/api/webhooks/whatsapp (Meta) or /api/webhooks/twilio", "Business-initiated messages need Meta-approved templates → Templates page"],
  PUSH: ["PUSH_DRIVER=webpush", "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys), VAPID_SUBJECT=mailto:…", "Users switch push on per device in their notification settings"],
};

export async function ChannelAdmin({ ctx, channel }: { ctx: Ctx; channel: "EMAIL" | "SMS" | "WHATSAPP" | "PUSH" }) {
  const st = (await channelsOverview(ctx)).find((c) => c.channel === channel)!;
  const manage = can(ctx, "admin.notifications.manage");
  const title = { EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp Integration", PUSH: "Push Notifications" }[channel];
  return (
    <>
      <PageHeader title={title} description={`Provider: ${st.driver}${st.driver === "log" ? " — development mode: messages are written to the outbox folder, nothing leaves the server." : st.ready ? " — configured." : ` — missing settings: ${st.missing.join(", ")}`}`} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Channel</CardTitle></CardHeader><CardContent className="space-y-3">
          <ChannelSwitch channel={channel} enabled={st.enabled} canEdit={manage} />
          <div className="text-xs text-muted-foreground">Status: <Badge variant={st.driver === "log" ? "warning" : st.ready ? "success" : "destructive"}>{st.driver === "log" ? "development (log)" : st.ready ? "live" : "not configured"}</Badge></div>
          {manage && channel !== "PUSH" && <TestSendForm channel={channel} />}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Setup (server environment)</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-1 pl-5 font-mono text-xs">{SETUP[channel].map((l) => <li key={l}>{l}</li>)}</ul></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Recent messages</CardTitle></CardHeader><CardContent><MessagesTable ctx={ctx} channel={channel} take={50} /></CardContent></Card>
    </>
  );
}

export async function TemplatesAdmin({ ctx, sp }: { ctx: Ctx; sp: { event?: string; channel?: string; locale?: string } }) {
  const manage = can(ctx, "admin.notifications.manage");
  const [events, overrides] = await Promise.all([eventSettings(ctx), listOverrides(ctx)]);
  const eventKey = sp.event && events.some((e) => e.key === sp.event) ? sp.event : events[0].key;
  const channel = (["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"].includes(sp.channel ?? "") ? sp.channel : "EMAIL") as NotificationChannel;
  const locale = (UI_LOCALES as readonly string[]).includes(sp.locale ?? "") ? sp.locale! : "pt-PT";
  const ed = await templateEditor(ctx, eventKey, channel, locale);
  return (
    <>
      <PageHeader title="Notification Templates" description="Which channels each event uses, and the text per channel and language. Default texts come with the app in every language; a saved text replaces it for that channel and language." />
      <Card className="mb-4"><CardHeader><CardTitle>Edit a text</CardTitle></CardHeader><CardContent className="space-y-4">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <select name="event" defaultValue={eventKey} className="h-9 rounded-md border bg-card px-2">{events.map((e) => <option key={e.key} value={e.key}>{e.key}</option>)}</select>
          <select name="channel" defaultValue={channel} className="h-9 rounded-md border bg-card px-2">{(["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"] as const).map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}</select>
          <select name="locale" defaultValue={locale} className="h-9 rounded-md border bg-card px-2">{UI_LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}</select>
          <button className="h-9 rounded-md border px-3 hover:bg-accent">Open</button>
        </form>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            {manage ? (
              <TemplateForm key={`${eventKey}-${channel}-${locale}`} eventKey={eventKey} channel={channel} locale={locale} vars={ed.def.vars} hasOverride={!!ed.template}
                subject={ed.template?.subject ?? ed.defaults?.title ?? ""} body={ed.template?.body ?? ed.defaults?.body ?? ""} waTemplateName={ed.template?.waTemplateName ?? ""} waLanguage={ed.template?.waLanguage ?? locale.replace("-", "_")} isActive={ed.template?.isActive ?? true} />
            ) : <p className="text-sm text-muted-foreground">You can view templates; only Super Admin can change them.</p>}
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="template-preview">
            <div className="mb-1 text-xs uppercase text-muted-foreground">Preview ({locale}, sample data){ed.template ? " · custom text" : " · default text"}</div>
            <div className="font-semibold">{ed.preview.title}</div><p>{ed.preview.body}</p>
            {ed.preview.wa && <p className="mt-2 text-xs text-muted-foreground">WhatsApp template: {ed.preview.wa.name} ({ed.preview.wa.language})</p>}
          </div>
        </div>
      </CardContent></Card>
      <Card className="mb-4"><CardHeader><CardTitle>Channels per event</CardTitle></CardHeader><CardContent>
        <Table>
          <THead><TR><TH>Event</TH><TH>Topic</TH><TH>Placeholders</TH><TH>Channels (in-app always)</TH></TR></THead>
          <TBody>
            {events.map((e) => (
              <TR key={e.key}>
                <TD className="font-mono text-xs"><Link href={`?event=${e.key}&channel=${channel}&locale=${locale}`} className="text-primary hover:underline">{e.key}</Link>{e.critical && <Badge variant="secondary" className="ml-1">critical</Badge>}</TD>
                <TD className="text-xs">{e.category}</TD>
                <TD className="text-xs">{e.vars.map((v) => `{${v}}`).join(" ") || "—"}</TD>
                <TD>{manage ? <EventChannelsForm eventKey={e.key} current={e.current as never} defaults={e.channels as never} overridden={e.overridden} /> : <span className="text-xs">{e.current.map((c) => CH_LABEL[c]).join(", ")}</span>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Custom texts ({overrides.length})</CardTitle></CardHeader><CardContent className="text-xs">
        {overrides.length === 0 ? "None — every message uses the default text." : overrides.map((o) => <div key={o.id}><Link className="text-primary hover:underline" href={`?event=${o.eventKey}&channel=${o.channel}&locale=${o.locale}`}>{o.eventKey} · {CH_LABEL[o.channel]} · {o.locale}</Link>{o.isActive ? "" : " (off)"}</div>)}
      </CardContent></Card>
    </>
  );
}

export async function InboxAdmin({ ctx, audience, title, from }: { ctx: Ctx; audience: Audience; title: string; from?: string }) {
  const [convs, locale] = await Promise.all([inbox(ctx, audience), getLocale()]);
  const sel = from ? await conversation(ctx, from) : null;
  const canReply = can(ctx, ["admin.messages.manage", "admin.notifications.manage"]);
  const selConv = convs.find((c) => c.from === from);
  return (
    <>
      <PageHeader title={title} description="Messages people sent to FIRINGI by SMS or WhatsApp, matched to their account by mobile number." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card><CardContent className="divide-y p-0">
          {convs.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No messages.</p>}
          {convs.map((c) => (
            <Link key={c.from} href={`?from=${encodeURIComponent(c.from)}`} className={`block px-3 py-2 text-sm hover:bg-accent ${c.from === from ? "bg-accent" : ""}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.user?.name ?? c.from}</span>{c.unhandled > 0 && <Badge variant="destructive">{c.unhandled}</Badge>}</div>
              <div className="text-xs text-muted-foreground">{c.user ? `${c.user.memberships[0]?.company.tradeName ?? c.user.memberships[0]?.company.legalName ?? ""} · ${c.from}` : "Unknown number"} · {CH_LABEL[c.channel]}</div>
              <div className="line-clamp-1 text-xs">{c.last.body}</div>
            </Link>
          ))}
        </CardContent></Card>
        <Card className="lg:col-span-2"><CardContent className="space-y-3 pt-5">
          {!sel ? <p className="text-sm text-muted-foreground">Choose a conversation.</p> : (
            <>
              <div className="max-h-[28rem] space-y-2 overflow-y-auto" data-testid="conversation">
                {sel.items.map((m) => (
                  <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.dir === "in" ? "bg-muted" : "ml-auto bg-primary text-primary-foreground"}`}>
                    <div className="whitespace-pre-line">{m.body}</div>
                    <div className="mt-0.5 text-[10px] opacity-70">{formatDate(m.at, locale, true)} · {CH_LABEL[m.channel]}{m.status ? ` · ${m.status.toLowerCase()}` : ""}</div>
                  </div>
                ))}
              </div>
              {canReply && <ReplyForm from={sel.from} defaultChannel={selConv?.channel === "SMS" ? "SMS" : "WHATSAPP"} whatsappOpen={sel.whatsappWindowOpen} />}
            </>
          )}
        </CardContent></Card>
      </div>
    </>
  );
}
