/**
 * Marketing campaigns (Phase 15): a message to an audience of business customers and/or
 * suppliers on e-mail, push, in-app, SMS and WhatsApp — optionally promoting an offer or coupon.
 *
 *  • Audience: a CRM segment (buyers), or company types (customers, wholesalers, distributors)
 *    and countries, or chosen companies. Every active member of those companies.
 *  • Consent: marketing goes to everyone unless they switched "Offers & news" off (per channel,
 *    in their notification settings, or with the unsubscribe link in every e-mail). SMS and
 *    WhatsApp also need the person's consent and a mobile number; WhatsApp needs a template
 *    approved by Meta. Skipped people are recorded with the reason.
 *  • Texts per language ({ en, pt, … }); a missing language falls back to English.
 *  • Tracking: each person × channel has a token — e-mail opens (pixel), clicks (the button /
 *    link goes through FIRINGI) and unsubscribes. Orders are attributed to a campaign when the
 *    company places one within 7 days after a click, or uses the campaign's coupon / offer.
 */
import { randomBytes } from "node:crypto";
import type { CompanyType, NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { BRAND_SLOGAN } from "@/config/brand";
import { activityRows, matchesSegment, normaliseRules } from "@/server/services/crm-insights";
import { appUrl, deliverMessage, enabledChannels, esc, messages, uiLocaleFor } from "@/server/notify/dispatch";
import { driverFor } from "@/server/notify/providers";
import { normalisePhone } from "@/server/notify/events";
import { writeAudit } from "@/server/services/audit";

export const MARKETING = "marketing"; // preference category
export const CAMPAIGN_CHANNELS: NotificationChannel[] = ["EMAIL", "PUSH", "IN_APP", "SMS", "WHATSAPP"];
const ATTRIBUTION_DAYS = 7;

export type Audience = { segmentId?: string | null; types?: CompanyType[]; countryCodes?: string[]; companyIds?: string[] };
export type Texts = Record<string, string>;
export type CampaignInput = {
  name: string; channels: NotificationChannel[]; audience: Audience; subject: Texts; body: Texts; ctaLabel?: Texts | null; ctaPath?: string | null;
  promotionId?: string | null; waTemplateName?: string | null; scheduledAt?: Date | null;
};

function assertView(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.marketing.view", "admin.marketing.manage"])) throw new ForbiddenError();
}
function assertManage(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.marketing.manage")) throw new ForbiddenError();
}
const clean = (t: Texts | null | undefined) => Object.fromEntries(Object.entries(t ?? {}).map(([k, v]) => [k, (v ?? "").trim()]).filter(([, v]) => v)) as Texts;
const pick = (t: unknown, locale: string) => { const o = (t ?? {}) as Texts; return o[locale] ?? o[locale.split("-")[0]] ?? o.en ?? Object.values(o)[0] ?? ""; };

// ── audience ────────────────────────────────────────────────────────────────

/** Companies a campaign reaches. */
export async function audienceCompanies(a: Audience): Promise<{ id: string; type: CompanyType; countryId: string }[]> {
  if (a.companyIds?.length)
    return prisma.company.findMany({ where: { id: { in: a.companyIds }, status: "APPROVED", type: { not: "ADMIN" } }, select: { id: true, type: true, countryId: true } });
  if (a.segmentId) {
    const seg = await prisma.crmSegment.findUnique({ where: { id: a.segmentId } });
    if (!seg) throw new ValidationError("That segment no longer exists.");
    const rules = normaliseRules(seg.rules);
    const ids = (await activityRows()).filter((r) => matchesSegment(r, rules)).map((r) => r.id);
    return prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, countryId: true } });
  }
  const types = (a.types?.length ? a.types : ["CUSTOMER", "WHOLESALER"]) as CompanyType[];
  return prisma.company.findMany({
    where: { status: "APPROVED", isInHouse: false, type: { in: types.filter((t) => t !== "ADMIN") }, ...(a.countryCodes?.length ? { country: { code: { in: a.countryCodes } } } : {}) },
    select: { id: true, type: true, countryId: true },
  });
}

/** How many companies / people the audience has, and how many each channel can reach. */
export async function previewAudience(ctx: Ctx, a: Audience, channels: NotificationChannel[]) {
  assertView(ctx);
  const companies = await audienceCompanies(a);
  const people = await members(companies.map((c) => c.id));
  const optOut = await optedOut(people.map((p) => p.userId));
  const push = new Set((await prisma.pushSubscription.findMany({ where: { userId: { in: people.map((p) => p.userId) } }, select: { userId: true } })).map((s) => s.userId));
  const reach = Object.fromEntries(channels.map((ch) => [ch, people.filter((p) => !optOut.has(`${p.userId}:${ch}`) && reachable(p, ch, push).ok).length]));
  return { companies: companies.length, people: people.length, reach };
}

type Person = { userId: string; companyId: string; countryId: string; email: string; name: string; phone: string | null; smsConsent: boolean; waConsent: boolean; locale: string | null };

async function members(companyIds: string[]): Promise<Person[]> {
  const rows = await prisma.membership.findMany({
    where: { companyId: { in: companyIds }, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { companyId: true, company: { select: { countryId: true } }, user: { select: { id: true, email: true, name: true, phone: true, smsConsentAt: true, whatsappConsentAt: true, locale: true } } },
  });
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.user.id) && seen.add(r.user.id)).map((r) => ({
    userId: r.user.id, companyId: r.companyId, countryId: r.company.countryId, email: r.user.email, name: r.user.name, phone: normalisePhone(r.user.phone),
    smsConsent: !!r.user.smsConsentAt, waConsent: !!r.user.whatsappConsentAt, locale: r.user.locale,
  }));
}

async function optedOut(userIds: string[]) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: { in: userIds }, category: MARKETING, enabled: false }, select: { userId: true, channel: true } });
  return new Set(rows.map((r) => `${r.userId}:${r.channel}`));
}

function reachable(p: Person, ch: NotificationChannel, push: Set<string>, waTemplate?: string | null): { ok: true } | { ok: false; why: string } {
  if ((ch === "SMS" || ch === "WHATSAPP") && !p.phone) return { ok: false, why: "No valid mobile number" };
  if (ch === "SMS" && !p.smsConsent) return { ok: false, why: "No SMS consent" };
  if (ch === "WHATSAPP" && !p.waConsent) return { ok: false, why: "No WhatsApp consent" };
  if (ch === "WHATSAPP" && waTemplate === null) return { ok: false, why: "No approved WhatsApp template" };
  if (ch === "PUSH" && !push.has(p.userId)) return { ok: false, why: "No push device" };
  return { ok: true };
}

// ── campaigns ───────────────────────────────────────────────────────────────

function validate(i: CampaignInput) {
  if (!i.name.trim()) throw new ValidationError("Name the campaign.");
  i.channels = [...new Set(i.channels)].filter((c) => CAMPAIGN_CHANNELS.includes(c));
  if (!i.channels.length) throw new ValidationError("Choose at least one channel.");
  i.subject = clean(i.subject); i.body = clean(i.body); i.ctaLabel = clean(i.ctaLabel);
  if (!i.subject.en || !i.body.en) throw new ValidationError("Write the title and the message in English at least (other languages fall back to it).");
  if (i.ctaPath && !/^\/[\w\-/?=&.%]*$/.test(i.ctaPath)) throw new ValidationError("The link must be a FIRINGI page, e.g. /buy/catalogue/deals.");
  if (i.channels.includes("WHATSAPP") && !i.waTemplateName?.trim()) throw new ValidationError("WhatsApp needs the name of a marketing template approved by Meta.");
  if (i.scheduledAt && i.scheduledAt.getTime() < Date.now() - 60_000) throw new ValidationError("Schedule it for a time in the future.");
}

export async function saveCampaign(ctx: Ctx, id: string | null, i: CampaignInput) {
  assertManage(ctx);
  validate(i);
  if (i.promotionId && !(await prisma.promotion.findUnique({ where: { id: i.promotionId } }))) throw new ValidationError("That offer no longer exists.");
  if (id) {
    const cur = await prisma.marketingCampaign.findUnique({ where: { id } });
    if (!cur) throw new NotFoundError("Campaign");
    if (cur.status !== "DRAFT" && cur.status !== "SCHEDULED") throw new ValidationError("A campaign that was sent can't be changed. Duplicate it instead.");
  }
  const data = {
    name: i.name.trim(), channels: i.channels, audience: i.audience as Prisma.InputJsonValue, subject: i.subject, body: i.body,
    ctaLabel: i.ctaLabel && Object.keys(i.ctaLabel).length ? i.ctaLabel : undefined, ctaPath: i.ctaPath || null, promotionId: i.promotionId || null,
    crmSegmentId: i.audience.segmentId || null, waTemplateName: i.waTemplateName?.trim() || null, scheduledAt: i.scheduledAt ?? null,
    status: i.scheduledAt ? ("SCHEDULED" as const) : ("DRAFT" as const),
  };
  const c = id ? await prisma.marketingCampaign.update({ where: { id }, data }) : await prisma.marketingCampaign.create({ data: { ...data, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: id ? "campaign.updated" : "campaign.created", entityType: "MarketingCampaign", entityId: c.id, after: { name: data.name, channels: data.channels, scheduledAt: data.scheduledAt } });
  return c;
}

export async function cancelCampaign(ctx: Ctx, id: string) {
  assertManage(ctx);
  const r = await prisma.marketingCampaign.updateMany({ where: { id, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
  if (!r.count) throw new ValidationError("Only a draft or scheduled campaign can be cancelled.");
}

export async function duplicateCampaign(ctx: Ctx, id: string) {
  assertManage(ctx);
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Campaign");
  return prisma.marketingCampaign.create({
    data: {
      name: `${c.name} (copy)`, channels: c.channels, audience: c.audience as Prisma.InputJsonValue, subject: c.subject as Prisma.InputJsonValue, body: c.body as Prisma.InputJsonValue,
      ctaLabel: (c.ctaLabel ?? undefined) as Prisma.InputJsonValue | undefined, ctaPath: c.ctaPath, promotionId: c.promotionId, crmSegmentId: c.crmSegmentId, waTemplateName: c.waTemplateName, createdById: ctx.user.id,
    },
  });
}

/** Send now (draft or scheduled). */
export async function sendCampaign(ctx: Ctx, id: string, fetchImpl?: typeof fetch) {
  assertManage(ctx);
  const claimed = await prisma.marketingCampaign.updateMany({ where: { id, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "SENDING" } });
  if (!claimed.count) throw new ValidationError("This campaign was already sent or cancelled.");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "campaign.sent", entityType: "MarketingCampaign", entityId: id });
  return deliverCampaign(id, fetchImpl);
}

/** Cron: send the scheduled campaigns that are due. */
export async function processScheduledCampaigns(fetchImpl?: typeof fetch) {
  const due = await prisma.marketingCampaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, select: { id: true } });
  let sent = 0;
  for (const d of due) {
    const claimed = await prisma.marketingCampaign.updateMany({ where: { id: d.id, status: "SCHEDULED" }, data: { status: "SENDING" } });
    if (claimed.count) { await deliverCampaign(d.id, fetchImpl); sent++; }
  }
  return { campaigns: sent };
}

type MarketingMsgs = { marketing?: { emailFooter?: string; unsubscribe?: string; open?: string } };

function campaignEmail(o: { title: string; body: string; cta: string | null; ctaLabel: string; pixel: string; unsubscribe: string; footer: string; unsubLabel: string; code: string | null }) {
  const para = esc(o.body).replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#eef1fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(30,41,99,.12)">
<tr><td style="background:linear-gradient(110deg,#e11d74,#7c3aed 55%,#f97316);background-color:#7c3aed;color:#fff;padding:22px 28px">
<b style="font-size:20px;letter-spacing:2px">FIRINGI</b><div style="font-size:10px;letter-spacing:3px;opacity:.85">${BRAND_SLOGAN}</div></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:#4c1d95">${esc(o.title)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 22px">${para}</p>
${o.code ? `<p style="margin:0 0 22px"><span style="display:inline-block;border:2px dashed #e11d74;border-radius:8px;padding:8px 14px;font:bold 18px/1 'Courier New',monospace;letter-spacing:3px;color:#be185d">${esc(o.code)}</span></p>` : ""}
${o.cta ? `<a href="${esc(o.cta)}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#e11d74);background-color:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:bold">${esc(o.ctaLabel)}</a>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;font-size:11px;color:#64748b">${esc(o.footer)} <a href="${esc(o.unsubscribe)}" style="color:#64748b">${esc(o.unsubLabel)}</a></td></tr>
</table></td></tr></table><img src="${esc(o.pixel)}" width="1" height="1" alt="" style="display:block;border:0"></body></html>`;
}

async function deliverCampaign(id: string, fetchImpl?: typeof fetch) {
  const c = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id }, include: { promotion: { select: { code: true } } } });
  const enabled = await enabledChannels();
  const companies = await audienceCompanies(c.audience as Audience);
  const people = await members(companies.map((x) => x.id));
  const optOut = await optedOut(people.map((p) => p.userId));
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: people.map((p) => p.userId) } } });
  const push = new Set(subs.map((s) => s.userId));
  const base = appUrl();
  const counts = { sent: 0, skipped: 0, failed: 0 };
  for (const p of people) {
    const locale = await uiLocaleFor(p.locale, p.countryId);
    const msgs = (await messages(locale)) as MarketingMsgs, en = (await messages("en")) as MarketingMsgs;
    const title = pick(c.subject, locale), body = pick(c.body, locale);
    const ctaLabel = pick(c.ctaLabel, locale) || msgs.marketing?.open || en.marketing?.open || "Open";
    for (const ch of c.channels) {
      const token = randomBytes(18).toString("base64url");
      const rec = { campaignId: c.id, userId: p.userId, companyId: p.companyId, channel: ch, token };
      const skip = async (why: string) => { await prisma.campaignRecipient.create({ data: { ...rec, status: "SKIPPED", skipReason: why } }); counts.skipped++; };
      if (ch !== "IN_APP" && !enabled.has(ch)) { await skip("Channel switched off by FIRINGI"); continue; }
      if (optOut.has(`${p.userId}:${ch}`)) { await skip("Opted out of offers & news"); continue; }
      const can = reachable(p, ch, push, c.waTemplateName);
      if (!can.ok) { await skip(can.why); continue; }
      const click = `${base}/api/m/c/${token}`;
      if (ch === "IN_APP") {
        await prisma.notification.create({ data: { userId: p.userId, type: "marketing.campaign", title, body, link: `/api/m/c/${token}` } });
        await prisma.campaignRecipient.create({ data: { ...rec, status: "SENT" } });
        counts.sent++;
        continue;
      }
      const msg = { eventKey: "marketing.campaign", channel: ch, userId: p.userId, companyId: p.companyId, locale, link: click, provider: driverFor(ch), refType: "MarketingCampaign", refId: c.id };
      const rows: Prisma.NotificationMessageUncheckedCreateInput[] = [];
      if (ch === "EMAIL") {
        const html = campaignEmail({
          title, body, cta: click, ctaLabel, code: c.promotion?.code ?? null, pixel: `${base}/api/m/o/${token}`, unsubscribe: `${base}/m/u/${token}`,
          footer: msgs.marketing?.emailFooter ?? en.marketing?.emailFooter ?? "", unsubLabel: msgs.marketing?.unsubscribe ?? en.marketing?.unsubscribe ?? "Unsubscribe",
        });
        rows.push({ ...msg, to: p.email, subject: title, body: `${body}\n\n${click}\n\n— FIRINGI · ${BRAND_SLOGAN}\n${base}/m/u/${token}`, variables: { _html: html } });
      } else if (ch === "PUSH") {
        for (const s of subs.filter((x) => x.userId === p.userId))
          rows.push({ ...msg, to: s.endpoint.slice(0, 190), subject: title, body, variables: { _push: { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth } } });
      } else if (ch === "SMS") {
        rows.push({ ...msg, to: p.phone!, subject: title, body: `FIRINGI: ${title}. ${c.promotion?.code ? `${c.promotion.code} ` : ""}${click}` });
      } else if (ch === "WHATSAPP") {
        rows.push({ ...msg, to: p.phone!, subject: title, body, variables: { _wa: { name: c.waTemplateName!, language: locale, params: [p.name, title, c.promotion?.code ?? "", click] } } });
      }
      let status: "SENT" | "FAILED" = "FAILED";
      let messageId: string | null = null;
      for (const data of rows) {
        const row = await prisma.notificationMessage.create({ data });
        messageId ??= row.id;
        const r = await deliverMessage(row.id, fetchImpl);
        if (r?.status === "SENT") status = "SENT";
      }
      await prisma.campaignRecipient.create({ data: { ...rec, status, messageId } });
      counts[status === "SENT" ? "sent" : "failed"]++;
    }
  }
  await prisma.marketingCampaign.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  return counts;
}

// ── tracking (public links) ─────────────────────────────────────────────────

export async function trackOpen(token: string) {
  await prisma.campaignRecipient.updateMany({ where: { token, openedAt: null }, data: { openedAt: new Date() } });
}

/** A click: recorded (also counts as opened); returns where to go. */
export async function trackClick(token: string) {
  const r = await prisma.campaignRecipient.findUnique({ where: { token }, include: { campaign: { select: { ctaPath: true } }, company: { select: { type: true } } } });
  if (!r) return "/";
  const now = new Date();
  await prisma.campaignRecipient.update({ where: { id: r.id }, data: { clickedAt: r.clickedAt ?? now, openedAt: r.openedAt ?? now } });
  return r.campaign.ctaPath || (r.company.type === "CUSTOMER" || r.company.type === "WHOLESALER" ? "/buy/catalogue/deals" : "/");
}

/** Unsubscribe link: offers & news off on every channel for that person. */
export async function unsubscribe(token: string) {
  const r = await prisma.campaignRecipient.findUnique({ where: { token }, select: { userId: true } });
  if (!r) return false;
  for (const channel of ["EMAIL", "SMS", "WHATSAPP", "PUSH", "IN_APP"] as NotificationChannel[])
    await prisma.notificationPreference.upsert({
      where: { userId_category_channel: { userId: r.userId, category: MARKETING, channel } },
      update: { enabled: false }, create: { userId: r.userId, category: MARKETING, channel, enabled: false },
    });
  await writeAudit({ actorUserId: r.userId, action: "marketing.unsubscribed", entityType: "User", entityId: r.userId });
  return true;
}

// ── reading ─────────────────────────────────────────────────────────────────

export async function listCampaigns(ctx: Ctx) {
  assertView(ctx);
  const rows = await prisma.marketingCampaign.findMany({ orderBy: { createdAt: "desc" }, include: { promotion: { select: { id: true, name: true, code: true } }, segment: { select: { name: true } } } });
  const stats = await campaignStats(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, stats: stats.get(r.id)! }));
}

export async function getCampaign(ctx: Ctx, id: string) {
  assertView(ctx);
  const c = await prisma.marketingCampaign.findUnique({ where: { id }, include: { promotion: { select: { id: true, name: true, code: true } }, segment: { select: { id: true, name: true } } } });
  if (!c) throw new NotFoundError("Campaign");
  const [stats, byChannel] = await Promise.all([
    campaignStats([id]).then((m) => m.get(id)!),
    prisma.campaignRecipient.groupBy({ by: ["channel", "status"], where: { campaignId: id }, _count: { _all: true } }),
  ]);
  const skipped = await prisma.campaignRecipient.groupBy({ by: ["skipReason"], where: { campaignId: id, status: "SKIPPED" }, _count: { _all: true } });
  return { ...c, stats, byChannel: byChannel.map((b) => ({ channel: b.channel, status: b.status, count: b._count._all })), skipped: skipped.map((s) => ({ reason: s.skipReason ?? "—", count: s._count._all })) };
}

export type CampaignStats = { recipients: number; sent: number; skipped: number; failed: number; opened: number; clicked: number; companiesClicked: number; orders: number; revenue: number; discount: number };

/**
 * Per campaign: delivery, opens, clicks, and attributed orders — orders by companies that
 * clicked, placed within 7 days after their click, plus orders that used the campaign's offer
 * after it was sent. Revenue = goods (net), discount = what the offer cost on those orders.
 */
export async function campaignStats(ids: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  if (!ids.length) return out;
  const [recips, camps] = await Promise.all([
    prisma.campaignRecipient.findMany({ where: { campaignId: { in: ids } }, select: { campaignId: true, status: true, openedAt: true, clickedAt: true, companyId: true } }),
    prisma.marketingCampaign.findMany({ where: { id: { in: ids } }, select: { id: true, sentAt: true, promotionId: true } }),
  ]);
  for (const c of camps) {
    const rs = recips.filter((r) => r.campaignId === c.id);
    const clicks = new Map<string, Date>();
    for (const r of rs) if (r.clickedAt && (!clicks.has(r.companyId) || r.clickedAt < clicks.get(r.companyId)!)) clicks.set(r.companyId, r.clickedAt);
    const orderIds = new Set<string>();
    let revenue = 0, discount = 0;
    if (c.sentAt) {
      const or: Prisma.OrderWhereInput[] = [...clicks].map(([companyId, at]) => ({ buyerCompanyId: companyId, placedAt: { gte: at, lte: new Date(at.getTime() + ATTRIBUTION_DAYS * 86400_000) } }));
      if (c.promotionId) or.push({ redemptions: { some: { promotionId: c.promotionId } }, placedAt: { gte: c.sentAt } });
      if (or.length) {
        const orders = await prisma.order.findMany({ where: { status: { not: "CANCELLED" }, OR: or }, select: { id: true, netTotal: true, deliveryFeeNet: true, redemptions: { where: c.promotionId ? { promotionId: c.promotionId } : { id: "-" }, select: { amount: true } } } });
        for (const o of orders) {
          if (orderIds.has(o.id)) continue;
          orderIds.add(o.id);
          revenue += Number(o.netTotal) - Number(o.deliveryFeeNet);
          discount += o.redemptions.reduce((a, r) => a + Number(r.amount), 0);
        }
      }
    }
    out.set(c.id, {
      recipients: rs.length, sent: rs.filter((r) => r.status === "SENT").length, skipped: rs.filter((r) => r.status === "SKIPPED").length, failed: rs.filter((r) => r.status === "FAILED").length,
      opened: rs.filter((r) => r.openedAt).length, clicked: rs.filter((r) => r.clickedAt).length, companiesClicked: clicks.size,
      orders: orderIds.size, revenue: Math.round(revenue * 100) / 100, discount: Math.round(discount * 100) / 100,
    });
  }
  return out;
}
