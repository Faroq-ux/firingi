/**
 * notify(event, targets, vars) — the one way FIRINGI tells people something.
 *
 *  1. recipients: a company's active members allowed to see this kind of event (or one user)
 *  2. language: the user's chosen language, else the company country's language, else English
 *  3. channels: in-app always; e-mail / SMS / WhatsApp / push per the event (FIRINGI can change
 *     them), platform switches, the user's preferences, phone number and consent
 *  4. text: FIRINGI's template for that event/channel/language, else the default text
 *  5. every outgoing message is logged (NotificationMessage) and sent; failures are retried
 * Never throws: a message problem must not undo the business action that caused it.
 */
import type { NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { UI_LOCALES } from "@/i18n/config";
import { computeEffectivePermissions } from "@/server/rbac/effective";
import { BRAND_SLOGAN } from "@/config/brand";
import { channelsFor, eventDef, fill, messageKey, normalisePhone, type EventDef } from "./events";
import { sendVia, driverFor } from "./providers";

export type Target = { companyId: string; link?: string | null } | { userId: string; link?: string | null };
export type Vars = Record<string, string | number | null | undefined>;

const SETTING_CHANNELS = "notify.channels";
const SETTING_EVENTS = "notify.events";
const MAX_ATTEMPTS = 5;
const ALL: NotificationChannel[] = ["EMAIL", "SMS", "WHATSAPP", "PUSH"];

// ── settings ────────────────────────────────────────────────────────────────

export async function enabledChannels(): Promise<Set<NotificationChannel>> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTING_CHANNELS } } });
  const v = (s?.value ?? {}) as Partial<Record<NotificationChannel, boolean>>;
  return new Set(ALL.filter((c) => v[c] !== false));
}
export async function eventChannelOverrides(): Promise<Record<string, NotificationChannel[]>> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTING_EVENTS } } });
  return (s?.value ?? {}) as Record<string, NotificationChannel[]>;
}
export const SETTINGS_KEYS = { SETTING_CHANNELS, SETTING_EVENTS };

// ── texts ───────────────────────────────────────────────────────────────────

type Msgs = { notify?: Record<string, { title: string; body: string }>; onboarding?: { restricted?: Record<string, string> } };
const msgCache = new Map<string, Msgs>();
export async function messages(locale: string): Promise<Msgs> {
  if (!msgCache.has(locale)) {
    try {
      msgCache.set(locale, (await import(`@/messages/${locale}.json`)).default as Msgs);
    } catch {
      msgCache.set(locale, {});
    }
  }
  return msgCache.get(locale)!;
}

/** Title + body of an event for a channel and language (FIRINGI's template wins). */
export { uiLocaleFor, appUrl, esc };

export async function renderEvent(eventKey: string, channel: NotificationChannel, locale: string, vars: Vars) {
  const tpl = await prisma.notificationTemplate.findUnique({ where: { eventKey_channel_locale: { eventKey, channel, locale } } });
  const [loc, en] = await Promise.all([messages(locale), messages("en")]);
  const k = messageKey(eventKey);
  // Amounts in the recipient's number format (EUR).
  if (typeof vars.total === "number") vars = { ...vars, total: new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(vars.total) };
  // Coded values shown in the recipient's language (e.g. restriction TOBACCO → "Tabaco").
  if (typeof vars.restriction === "string" && /^[A-Z]+$/.test(vars.restriction))
    vars = { ...vars, restriction: (loc.onboarding?.restricted?.[vars.restriction] ?? en.onboarding?.restricted?.[vars.restriction] ?? vars.restriction).toLowerCase() };
  const def = loc.notify?.[k] ?? en.notify?.[k] ?? { title: eventKey, body: "" };
  const title = fill(tpl?.isActive && tpl.subject ? tpl.subject : def.title, vars);
  const body = fill(tpl?.isActive ? tpl.body : def.body, vars);
  const wa = tpl?.isActive && tpl.waTemplateName ? { name: tpl.waTemplateName, language: tpl.waLanguage ?? locale } : null;
  return { title, body, wa };
}

const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function emailHtml(title: string, body: string, link: string | null, openLabel: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0f172a;color:#fff;padding:16px 24px"><b style="font-size:18px;letter-spacing:1px">FIRINGI</b><div style="font-size:10px;letter-spacing:3px;opacity:.7">${BRAND_SLOGAN}</div></td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1><p style="font-size:14px;line-height:1.5;margin:0 0 20px">${esc(body)}</p>
${link ? `<a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${esc(openLabel)}</a>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

// ── recipients ──────────────────────────────────────────────────────────────

type Recipient = { userId: string; email: string; phone: string | null; smsConsent: boolean; waConsent: boolean; locale: string; companyId: string | null; link: string | null };

async function uiLocaleFor(userLocale: string | null, countryId: string | null): Promise<string> {
  const ui = UI_LOCALES as readonly string[];
  if (userLocale && ui.includes(userLocale)) return userLocale;
  if (countryId) {
    const langs = await prisma.countryLanguage.findMany({ where: { countryId }, orderBy: { sortOrder: "asc" }, select: { languageCode: true } });
    const hit = langs.find((l) => ui.includes(l.languageCode));
    if (hit) return hit.languageCode;
  }
  return "en";
}

/**
 * Phase 27: what an Order / Invoice / approval / budget notification is about decides which of the
 * buyer's branch staff get it — staff assigned to branches only hear about their own branches.
 */
export async function branchOfRef(ref?: { type: string; id: string } | null): Promise<{ companyId: string; branchId: string | null } | null> {
  if (!ref) return null;
  if (ref.type === "Order") {
    const o = await prisma.order.findUnique({ where: { id: ref.id }, select: { buyerCompanyId: true, branchId: true } });
    return o ? { companyId: o.buyerCompanyId, branchId: o.branchId } : null;
  }
  if (ref.type === "Invoice") {
    const i = await prisma.invoice.findUnique({ where: { id: ref.id }, select: { recipientCompanyId: true, order: { select: { branchId: true } } } });
    return i ? { companyId: i.recipientCompanyId, branchId: i.order?.branchId ?? null } : null;
  }
  if (ref.type === "BuyerApproval") {
    const a = await prisma.buyerApproval.findUnique({ where: { id: ref.id }, select: { companyId: true, deliveryAddressId: true } });
    if (!a) return null;
    const addr = await prisma.address.findUnique({ where: { id: a.deliveryAddressId }, select: { branchId: true } });
    return { companyId: a.companyId, branchId: addr?.branchId ?? null };
  }
  if (ref.type === "Budget") {
    const b = await prisma.budget.findUnique({ where: { id: ref.id }, select: { companyId: true, branchId: true } });
    return b ? { companyId: b.companyId, branchId: b.branchId } : null;
  }
  return null;
}

async function recipients(def: EventDef, targets: Target[], branchRef: { companyId: string; branchId: string | null } | null = null): Promise<Recipient[]> {
  const out = new Map<string, Recipient>();
  for (const t of targets) {
    const link = t.link ? (t.link.startsWith("http") ? t.link : `${appUrl()}${t.link}`) : null;
    if ("userId" in t) {
      const u = await prisma.user.findUnique({ where: { id: t.userId }, include: { memberships: { where: { status: "ACTIVE" }, take: 1, include: { company: { select: { id: true, countryId: true } } } } } });
      if (!u || u.status !== "ACTIVE" || out.has(u.id)) continue;
      const c = u.memberships[0]?.company ?? null;
      out.set(u.id, { userId: u.id, email: u.email, phone: normalisePhone(u.phone), smsConsent: !!u.smsConsentAt, waConsent: !!u.whatsappConsentAt, locale: await uiLocaleFor(u.locale, c?.countryId ?? null), companyId: c?.id ?? null, link });
      continue;
    }
    const company = await prisma.company.findUnique({
      where: { id: t.companyId },
      include: {
        memberships: {
          where: { status: "ACTIVE", user: { status: "ACTIVE" } },
          include: { user: { include: { driver: { select: { status: true, ownerCompanyId: true } } } }, roles: { include: { role: { include: { permissions: { select: { permissionCode: true } } } } } }, branchAssignments: { select: { branchId: true } } },
        },
      },
    });
    if (!company) continue;
    for (const m of company.memberships) {
      if (out.has(m.userId)) continue;
      const branchScoped = branchRef?.companyId === company.id && m.branchAssignments.length > 0;
      if (def.perms || branchScoped) {
        const perms = computeEffectivePermissions({
          companyType: company.type, companyStatus: company.status, membershipStatus: m.status, userStatus: m.user.status, isOwner: m.isOwner,
          driverStatus: m.user.driver && m.user.driver.ownerCompanyId === company.id ? m.user.driver.status : null,
          roles: m.roles.map((r) => ({ key: r.role.key, isSystem: r.role.isSystem, permissionCodes: r.role.permissions.map((p) => p.permissionCode) })),
        });
        if (def.perms && !m.isOwner && !def.perms.some((p) => perms.has(p))) continue;
        // branch staff only hear about their own branches (people who manage branches hear about all)
        if (branchScoped && !perms.has("buyer.branches.manage") && !m.branchAssignments.some((b) => b.branchId === branchRef!.branchId)) continue;
      }
      const u = m.user;
      out.set(u.id, { userId: u.id, email: u.email, phone: normalisePhone(u.phone), smsConsent: !!u.smsConsentAt, waConsent: !!u.whatsappConsentAt, locale: await uiLocaleFor(u.locale, company.countryId), companyId: company.id, link });
    }
  }
  return [...out.values()];
}

// ── sending ─────────────────────────────────────────────────────────────────

const backoff = (attempt: number) => new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000); // 2, 4, 8, … min (max 1 h)

/** Send one logged message (first try or retry) and record the result. */
export async function deliverMessage(id: string, fetchImpl?: typeof fetch) {
  const m = await prisma.notificationMessage.findUnique({ where: { id } });
  if (!m || (m.status !== "QUEUED" && m.status !== "FAILED")) return m;
  const vars = (m.variables ?? {}) as { _wa?: { name: string; language: string; params: string[] }; _push?: { endpoint: string; p256dh: string; auth: string } };
  const r = await sendVia(
    { channel: m.channel, to: m.to, subject: m.subject, body: m.body, link: m.link, html: m.channel === "EMAIL" ? ((m.variables as { _html?: string } | null)?._html ?? emailHtml(m.subject ?? "FIRINGI", m.body, m.link, "FIRINGI →")) : null, waTemplate: vars._wa ?? null, push: vars._push ?? null },
    fetchImpl,
  );
  const attempts = m.attempts + 1;
  if (r.ok) return prisma.notificationMessage.update({ where: { id }, data: { status: "SENT", providerMessageId: r.id, attempts, sentAt: new Date(), error: null, nextAttemptAt: null } });
  if (r.error === "SUBSCRIPTION_GONE" && vars._push) await prisma.pushSubscription.deleteMany({ where: { endpoint: vars._push.endpoint } });
  const retry = r.retry && attempts < MAX_ATTEMPTS;
  return prisma.notificationMessage.update({ where: { id }, data: { status: "FAILED", error: r.error.slice(0, 500), attempts, nextAttemptAt: retry ? backoff(attempts) : null } });
}

/** Retry due messages (cron route / admin button). */
export async function processOutbox(limit = 100, fetchImpl?: typeof fetch) {
  const due = await prisma.notificationMessage.findMany({
    where: { OR: [{ status: "QUEUED" }, { status: "FAILED", nextAttemptAt: { lte: new Date() } }], attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" }, take: limit, select: { id: true },
  });
  let sent = 0, failed = 0;
  for (const d of due) {
    const r = await deliverMessage(d.id, fetchImpl);
    if (r?.status === "SENT") sent++; else failed++;
  }
  return { processed: due.length, sent, failed };
}

export type NotifyResult = { recipients: number; messages: { userId: string; channel: NotificationChannel; status: string }[] };

export async function notify(eventKey: string, targets: Target[], vars: Vars = {}, opts: { ref?: { type: string; id: string }; fetchImpl?: typeof fetch } = {}): Promise<NotifyResult> {
  const result: NotifyResult = { recipients: 0, messages: [] };
  try {
    const def = eventDef(eventKey);
    const [enabled, overrides, people] = await Promise.all([enabledChannels(), eventChannelOverrides(), branchOfRef(opts.ref).then((b) => recipients(def, targets, b))]);
    result.recipients = people.length;
    const eventChannels = overrides[eventKey] ?? def.channels;
    const prefs = await prisma.notificationPreference.findMany({ where: { userId: { in: people.map((p) => p.userId) }, category: def.category } });
    for (const p of people) {
      const mine = Object.fromEntries(prefs.filter((x) => x.userId === p.userId).map((x) => [x.channel, x.enabled])) as Partial<Record<NotificationChannel, boolean>>;
      for (const channel of channelsFor(def, eventChannels, enabled, mine)) {
        const text = await renderEvent(eventKey, channel, p.locale, vars);
        if (channel === "IN_APP") {
          await prisma.notification.create({ data: { userId: p.userId, type: eventKey, title: text.title, body: text.body, link: p.link ? p.link.replace(appUrl(), "") : null } });
          result.messages.push({ userId: p.userId, channel, status: "SENT" });
          continue;
        }
        const base = { eventKey, channel, userId: p.userId, companyId: p.companyId, locale: p.locale, link: p.link, provider: driverFor(channel), refType: opts.ref?.type ?? null, refId: opts.ref?.id ?? null };
        // Recipients this channel can't reach are logged as SKIPPED (visible in the back office).
        const skip = async (to: string, why: string) => {
          await prisma.notificationMessage.create({ data: { ...base, to, subject: text.title, body: text.body, status: "SKIPPED", error: why } });
          result.messages.push({ userId: p.userId, channel, status: "SKIPPED" });
        };
        if ((channel === "SMS" || channel === "WHATSAPP") && !p.phone) { await skip("-", "No valid mobile number"); continue; }
        if (channel === "SMS" && !p.smsConsent) { await skip(p.phone!, "No SMS consent"); continue; }
        if (channel === "WHATSAPP" && !p.waConsent) { await skip(p.phone!, "No WhatsApp consent"); continue; }
        const rows: Prisma.NotificationMessageUncheckedCreateInput[] = [];
        const varsJson = { ...vars } as Record<string, unknown>;
        if (channel === "WHATSAPP" && text.wa) varsJson._wa = { ...text.wa, params: def.vars.map((k) => String(vars[k] ?? "")) };
        if (channel === "PUSH") {
          const subs = await prisma.pushSubscription.findMany({ where: { userId: p.userId } });
          if (!subs.length) continue; // most users have no push device: nothing to log
          for (const s of subs) rows.push({ ...base, to: s.endpoint.slice(0, 190), subject: text.title, body: text.body, variables: { ...varsJson, _push: { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth } } as Prisma.InputJsonValue });
        } else {
          const body = channel === "SMS" || channel === "WHATSAPP" ? `FIRINGI: ${text.body}${p.link ? ` ${p.link}` : ""}` : `${text.body}${p.link ? `\n\n${p.link}` : ""}\n\n— FIRINGI · ${BRAND_SLOGAN}`;
          rows.push({ ...base, to: channel === "EMAIL" ? p.email : p.phone!, subject: text.title, body, variables: varsJson as Prisma.InputJsonValue });
        }
        for (const data of rows) {
          const row = await prisma.notificationMessage.create({ data });
          const sent = await deliverMessage(row.id, opts.fetchImpl);
          result.messages.push({ userId: p.userId, channel, status: sent?.status ?? "QUEUED" });
        }
      }
    }
  } catch (e) {
    console.error("[notify] failed", eventKey, e);
  }
  return result;
}
