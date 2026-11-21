/**
 * Channel providers. Each returns { ok, id } or { ok: false, error, retry } — never throws.
 *
 *   EMAIL     MAIL_DRIVER      log (default) | smtp            SMTP_URL, MAIL_FROM
 *   SMS       SMS_DRIVER       log (default) | twilio          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM
 *   WHATSAPP  WHATSAPP_DRIVER  log (default) | twilio | meta   twilio: TWILIO_WHATSAPP_FROM (whatsapp:+…)
 *                                                              meta:   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 *   PUSH      PUSH_DRIVER      log (default) | webpush         VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *
 * "log" writes each message to STORAGE_DIR/notify-outbox/<channel>/ so development and tests
 * never contact a real provider. WhatsApp messages FIRINGI starts must use a Meta-approved
 * template (name + language, variables as body parameters); replies inside the customer's
 * 24-hour window may be free text.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NotificationChannel } from "@prisma/client";

export type SendResult = { ok: true; id: string } | { ok: false; error: string; retry: boolean };
export type OutgoingMessage = {
  channel: NotificationChannel;
  to: string;
  subject?: string | null;
  body: string;
  html?: string | null;
  link?: string | null;
  /** WhatsApp template (business-initiated) — omit for a free-text reply. */
  waTemplate?: { name: string; language: string; params: string[] } | null;
  /** Web push subscription (PUSH). */
  push?: { endpoint: string; p256dh: string; auth: string } | null;
  /** Phase 39: unread notifications — the number on the installed app's icon. */
  badge?: number | null;
  /** Phase 58: WhatsApp reply buttons (Meta Cloud API, up to 3; other drivers send the text only). */
  buttons?: { id: string; title: string }[] | null;
};
type Fetch = typeof fetch;

export function driverFor(channel: NotificationChannel): string {
  const env = process.env;
  switch (channel) {
    case "EMAIL": return env.MAIL_DRIVER === "smtp" ? "smtp" : "log";
    case "SMS": return env.SMS_DRIVER === "twilio" ? "twilio" : "log";
    case "WHATSAPP": return env.WHATSAPP_DRIVER === "twilio" || env.WHATSAPP_DRIVER === "meta" ? env.WHATSAPP_DRIVER : "log";
    case "PUSH": return env.PUSH_DRIVER === "webpush" ? "webpush" : "log";
    default: return "in_app";
  }
}

/** Is the channel's real provider configured? (log is always "configured" for development.) */
export function providerStatus(channel: NotificationChannel): { driver: string; ready: boolean; missing: string[] } {
  const driver = driverFor(channel);
  const need: Record<string, string[]> = {
    smtp: ["SMTP_URL"], twilio: channel === "SMS" ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM"] : ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
    meta: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], webpush: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
  };
  const missing = (need[driver] ?? []).filter((k) => !process.env[k]);
  return { driver, ready: missing.length === 0, missing };
}

async function logDriver(m: OutgoingMessage): Promise<SendResult> {
  const id = `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage", "notify-outbox", m.channel.toLowerCase());
    await mkdir(dir, { recursive: true });
    const { push, ...rest } = m;
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), ...rest, push: push ? { endpoint: push.endpoint } : undefined }, null, 2));
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retry: true };
  }
}

/** Twilio REST API (SMS and WhatsApp). 4xx = permanent, 5xx / network = retry. */
async function twilio(m: OutgoingMessage, fetchImpl: Fetch): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { ok: false, error: "Twilio is not configured", retry: false };
  const wa = m.channel === "WHATSAPP";
  const form = new URLSearchParams({ To: wa ? `whatsapp:${m.to}` : m.to, From: wa ? process.env.TWILIO_WHATSAPP_FROM ?? "" : process.env.TWILIO_SMS_FROM ?? "" });
  if (wa && m.waTemplate) {
    form.set("ContentSid", m.waTemplate.name);
    form.set("ContentVariables", JSON.stringify(Object.fromEntries(m.waTemplate.params.map((p, i) => [String(i + 1), p]))));
  } else form.set("Body", m.body);
  if (process.env.TWILIO_STATUS_CALLBACK) form.set("StatusCallback", process.env.TWILIO_STATUS_CALLBACK);
  try {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST", body: form, signal: AbortSignal.timeout(15000),
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (res.ok && json.sid) return { ok: true, id: json.sid };
    return { ok: false, error: `Twilio ${res.status}: ${json.message ?? "error"}`, retry: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retry: true };
  }
}

/** Meta WhatsApp Cloud API. */
async function meta(m: OutgoingMessage, fetchImpl: Fetch): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: "WhatsApp Cloud API is not configured", retry: false };
  const to = m.to.replace(/^\+/, "");
  const payload = m.waTemplate
    ? {
        messaging_product: "whatsapp", to, type: "template",
        template: { name: m.waTemplate.name, language: { code: m.waTemplate.language }, components: m.waTemplate.params.length ? [{ type: "body", parameters: m.waTemplate.params.map((text) => ({ type: "text", text })) }] : [] },
      }
    : m.buttons?.length
      ? { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "button", body: { text: m.body.slice(0, 1024) }, action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } } }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: m.body, preview_url: false } };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST", body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (res.ok && json.messages?.[0]?.id) return { ok: true, id: json.messages[0].id };
    return { ok: false, error: `WhatsApp ${res.status}: ${json.error?.message ?? "error"}`, retry: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retry: true };
  }
}

async function smtp(m: OutgoingMessage): Promise<SendResult> {
  try {
    const nodemailer = await import("nodemailer");
    const info = await nodemailer.createTransport(process.env.SMTP_URL ?? "smtp://localhost:1025").sendMail({
      from: process.env.MAIL_FROM ?? "FIRINGI <no-reply@firingi.test>", to: m.to, subject: m.subject ?? "FIRINGI", text: m.body, html: m.html ?? undefined,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retry: true };
  }
}

async function webpush(m: OutgoingMessage): Promise<SendResult> {
  if (!m.push) return { ok: false, error: "No push subscription", retry: false };
  try {
    const wp = (await import("web-push")).default;
    wp.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:no-reply@firingi.test", process.env.VAPID_PUBLIC_KEY ?? "", process.env.VAPID_PRIVATE_KEY ?? "");
    const r = await wp.sendNotification({ endpoint: m.push.endpoint, keys: { p256dh: m.push.p256dh, auth: m.push.auth } }, JSON.stringify({ title: m.subject, body: m.body, link: m.link, ...(m.badge != null ? { badge: m.badge } : {}) }), { TTL: 3600 });
    return { ok: true, id: r.headers?.location ?? `push-${Date.now()}` };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // 404 / 410 = the browser unsubscribed: permanent.
    return { ok: false, error: status === 404 || status === 410 ? "SUBSCRIPTION_GONE" : e instanceof Error ? e.message : String(e), retry: !(status === 404 || status === 410) };
  }
}

export async function sendVia(m: OutgoingMessage, fetchImpl: Fetch = fetch): Promise<SendResult> {
  const d = driverFor(m.channel);
  if (d === "log") return logDriver(m);
  if (d === "smtp") return smtp(m);
  if (d === "twilio") return twilio(m, fetchImpl);
  if (d === "meta") return meta(m, fetchImpl);
  if (d === "webpush") return webpush(m);
  return { ok: false, error: `No provider for ${m.channel}`, retry: false };
}
