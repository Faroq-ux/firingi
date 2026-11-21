/**
 * Phase 56 — the public landing page. FIRINGI's settings (Setting "landing.settings"): sections on / off, contact and
 * company details, its own wording per language over the built-in translations,
 * hidden list items and the legal pages. Visitors' questions and vendor applications become CRM leads (source
 * WEBSITE) with the message as an activity; newsletter sign-ups wait for the e-mail confirmation (double opt-in).
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { UI_LOCALES } from "@/i18n/config";
import {
  LEGAL_PAGES, checkContact, cleanLanding, flatten, isEmail, lookup, looksLikeSpam, mergeLanding, underLimit,
  type ContactIn, type FormProblem, type LandingSettings, type LegalPage, type PlanLite, type TextSources,
} from "@/lib/landing";

const KEY = "landing.settings";
const WEBSITE_USER = "website@system.firingi";

export async function landingSettings(): Promise<LandingSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeLanding(row?.value as Partial<LandingSettings> | null);
}

function staff(ctx: Ctx, manage = true) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.marketing.manage" : ["admin.marketing.view", "admin.marketing.manage"])) throw new ForbiddenError();
}

export async function saveLandingSettings(ctx: Ctx, input: LandingSettings) {
  staff(ctx);
  let v: LandingSettings;
  try { v = cleanLanding(input, UI_LOCALES); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await landingSettings();
  // a legal page whose text changed gets a new "last updated" date
  for (const p of LEGAL_PAGES) if (JSON.stringify(before.legal[p]) !== JSON.stringify(v.legal[p])) v.legalUpdated[p] = new Date().toISOString().slice(0, 10);
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    update: { value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "landing.settings_saved", entityType: "Setting", entityId: KEY, before: { sections: before.sections, enabled: before.enabled }, after: { sections: v.sections, enabled: v.enabled, texts: Object.fromEntries(Object.entries(v.texts).map(([l, m]) => [l, Object.keys(m).length])) } });
  return v;
}

// ── texts ───────────────────────────────────────────────────────────────────

async function landingMessages(locale: string) {
  const file = (UI_LOCALES as readonly string[]).includes(locale) ? locale : "en";
  const m = (await import(`@/messages/${file}.json`)).default as { landing?: Record<string, unknown> };
  return flatten(m.landing ?? {});
}

/** The page's texts for a language: FIRINGI's wording first, then the translation, then English. */
export async function landingTexts(locale: string, s?: LandingSettings): Promise<TextSources> {
  const set = s ?? (await landingSettings());
  const [msgs, msgsEn] = await Promise.all([landingMessages(locale), landingMessages("en")]);
  return { own: set.texts[locale] ?? {}, ownEn: set.texts.en ?? {}, msgs, msgsEn };
}

/** Everything the page shows: settings, texts, live vendor plans. */
export async function landingPage(locale: string) {
  const s = await landingSettings();
  const [src, plans] = await Promise.all([
    landingTexts(locale, s),
    s.sections.plans ? prisma.supplierPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }) : Promise.resolve([]),
  ]);
  const pl: (PlanLite & { description: string })[] = plans.map((p) => ({
    code: p.code, name: p.name, description: lookup(src, `plans.desc.${p.code}`) || p.description || "", monthlyPrice: Number(p.monthlyPrice), features: p.features as string[],
    maxProducts: p.maxProducts, maxUsers: p.maxUsers, maxWarehouses: p.maxWarehouses, maxDrivers: p.maxDrivers, earlyPayModel: p.earlyPayModel, earlyPayRate: Number(p.earlyPayRate), freeEarlyPays: p.freeEarlyPays,
  }));
  return { settings: s, src, plans: pl };
}

/** The visitor's country, automatically: the browser's region when FIRINGI works there, else the first open market, else Portugal. */
export async function visitorCountry(acceptLanguage: string) {
  const regions = [...acceptLanguage.matchAll(/[a-z]{2,3}-([A-Z]{2})/gi)].map((m) => m[1].toUpperCase());
  const countries = await prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { id: true, code: true, customerMarketEnabled: true, wholesalerMarketEnabled: true } });
  return countries.find((c) => regions.includes(c.code)) ?? countries.find((c) => c.customerMarketEnabled || c.wholesalerMarketEnabled) ?? countries.find((c) => c.code === "PT") ?? null;
}

/** A legal page: FIRINGI's text in this language, else its English text, else the starting text (GDPR-based) with the company details. */
export async function legalPage(page: LegalPage, locale: string) {
  const s = await landingSettings();
  const own = s.legal[page][locale]?.trim() || s.legal[page].en?.trim() || "";
  const { defaultLegal } = await import("@/lib/landing-legal");
  const text = own || defaultLegal(page, locale, { ...s.company, email: s.email });
  return { text, own: !!own, updated: own ? s.legalUpdated[page] : null, company: s.company, email: s.email, phone: s.phone };
}

// ── visitors: contact and vendor interest → CRM ─────────────────────────────

const hits = new Map<string, number[]>();
function limited(bucket: string, ip: string, max = 5, windowMs = 10 * 60_000) {
  const now = Date.now(), k = `${bucket}:${ip}`;
  const { ok, recent } = underLimit(hits.get(k) ?? [], now, max, windowMs);
  if (ok) recent.push(now);
  hits.set(k, recent);
  if (hits.size > 10_000) for (const [key, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(key);
  return !ok;
}
export const ipHash = (ip: string | null) => (ip ? createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET ?? "firingi"}:${ip}`).digest("hex").slice(0, 32) : null);

/** The user the website's leads and notes are recorded under (it can't sign in). */
async function websiteUserId() {
  const u = await prisma.user.upsert({ where: { email: WEBSITE_USER }, update: {}, create: { email: WEBSITE_USER, name: "Website", status: "DISABLED", emailVerified: false } });
  return u.id;
}

export type ContactResult = { ok: true; leadNumber: string } | { ok: false; problem: FormProblem | "BUSY" };

export async function submitContact(i: ContactIn, meta: { ip: string | null; locale: string; acceptLanguage?: string }, now = Date.now()): Promise<ContactResult> {
  const problem = checkContact(i, now);
  if (problem) return { ok: false, problem };
  const ih = ipHash(meta.ip) ?? "none";
  if (limited("contact", ih)) return { ok: false, problem: "BUSY" };
  const clip = (s: string, n: number) => s.trim().slice(0, n);
  const email = clip(i.email, 254).toLowerCase();
  const country = (await visitorCountry(meta.acceptLanguage ?? "")) ?? await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
  const vendor = i.kind === "VENDOR";
  const by = await websiteUserId();
  const vendorType = vendor ? (i.vendorType ?? "DISTRIBUTOR") : null;
  const subject = vendor ? `Website: vendor application (${vendorType === "WHOLESALER" ? "wholesaler" : "distributor"})` : "Website: question";
  const body = [
    `${clip(i.name, 120)} · ${clip(i.company, 160)} · ${email}${i.phone ? ` · ${clip(i.phone, 40)}` : ""}${vendor && i.nif ? ` · NIF ${clip(i.nif, 20)}` : ""}`,
    i.type ? `Business: ${clip(i.type, 80)}` : null, `Language: ${meta.locale}`, "", clip(i.message, 4000),
  ].filter((x) => x !== null).join("\n");
  const lead = await prisma.$transaction(async (tx) => {
    // an open lead with the same e-mail gets the new message; otherwise a new lead
    let l = await tx.lead.findFirst({ where: { email, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }, orderBy: { createdAt: "desc" } });
    if (!l) {
      const { nextNumber } = await import("@/server/services/orders");
      const number = await nextNumber(tx, "lead", "LD");
      l = await tx.lead.create({
        data: {
          number, companyName: clip(i.company, 160), contactName: clip(i.name, 120), email, phone: i.phone ? clip(i.phone, 40) : null, countryId: country.id,
          kind: vendorType ?? "CUSTOMER", source: "WEBSITE", notes: body.slice(0, 2000), createdById: by,
        },
      });
      await tx.crmContact.create({ data: { leadId: l.id, name: clip(i.name, 120), email, phone: i.phone ? clip(i.phone, 40) : null, isPrimary: true } });
    }
    await tx.crmActivity.create({ data: { kind: "NOTE", outbound: false, subject, body, leadId: l.id, byUserId: by } });
    return l;
  });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  const { notify } = await import("@/server/notify/dispatch");
  if (admin) await notify(vendor ? "website.vendor_interest" : "website.contact", [{ companyId: admin.id, link: `/admin/crm/leads/${lead.id}` }], { company: clip(i.company, 160), name: clip(i.name, 120) }).catch(() => null);
  // a short "we got it" to the visitor, in the page's language
  const src = await landingTexts(meta.locale);
  const { sendMail } = await import("@/server/services/mailer");
  await sendMail({ to: email, subject: lookup(src, "mail.contactSubject"), text: [lookup(src, "mail.hello").replace("{name}", clip(i.name, 120)), lookup(src, "mail.contactBody"), lookup(src, "mail.sign")].join("\n\n") });
  return { ok: true, leadNumber: lead.number };
}

// ── newsletter (double opt-in) ──────────────────────────────────────────────

const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function subscribeNewsletter(i: { email: string; consent: boolean; website: string; startedAt: number }, meta: { ip: string | null; locale: string; acceptLanguage?: string }, now = Date.now()) {
  if (looksLikeSpam(i, now)) return { ok: false as const, problem: "SPAM" as const };
  if (!isEmail(i.email)) return { ok: false as const, problem: "EMAIL" as const };
  if (!i.consent) return { ok: false as const, problem: "CONSENT" as const };
  const ih = ipHash(meta.ip);
  if (limited("news", ih ?? "none")) return { ok: false as const, problem: "BUSY" as const };
  const email = i.email.trim().toLowerCase();
  const src = await landingTexts(meta.locale);
  const cur = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  // the same answer whether or not the address is known (no address checking from outside)
  if (cur?.status === "CONFIRMED") return { ok: true as const };
  const token = randomBytes(24).toString("base64url");
  const data = { locale: meta.locale, countryCode: (await visitorCountry(meta.acceptLanguage ?? ""))?.code ?? null, status: "PENDING" as const, token, consentText: lookup(src, "news.consent"), ipHash: ih, unsubscribedAt: null };
  if (cur) await prisma.newsletterSubscriber.update({ where: { id: cur.id }, data });
  else await prisma.newsletterSubscriber.create({ data: { email, ...data } });
  const { sendMail } = await import("@/server/services/mailer");
  await sendMail({ to: email, subject: lookup(src, "mail.newsSubject"), text: [lookup(src, "mail.helloAll"), `${lookup(src, "mail.newsBody")}\n${appUrl()}/newsletter/confirm?t=${token}`, lookup(src, "mail.newsIgnore"), lookup(src, "mail.sign")].join("\n\n") });
  return { ok: true as const };
}

export async function confirmNewsletter(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const s = await prisma.newsletterSubscriber.findUnique({ where: { token } });
  if (!s || s.status === "UNSUBSCRIBED") return null;
  if (s.status === "PENDING") await prisma.newsletterSubscriber.update({ where: { id: s.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
  return { locale: s.locale };
}

export async function unsubscribeNewsletter(token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const s = await prisma.newsletterSubscriber.findUnique({ where: { token } });
  if (!s) return null;
  if (s.status !== "UNSUBSCRIBED") await prisma.newsletterSubscriber.update({ where: { id: s.id }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
  return { locale: s.locale };
}

/** FIRINGI: subscribers with counts; the confirmed ones can be exported. */
export async function newsletterSubscribers(ctx: Ctx, f: { status?: string; q?: string } = {}) {
  staff(ctx, false);
  const where: Prisma.NewsletterSubscriberWhereInput = {
    ...(f.status && f.status !== "ALL" ? { status: f.status as "PENDING" | "CONFIRMED" | "UNSUBSCRIBED" } : {}),
    ...(f.q ? { email: { contains: f.q.trim().toLowerCase() } } : {}),
  };
  const [rows, counts] = await Promise.all([
    prisma.newsletterSubscriber.findMany({ where, orderBy: { createdAt: "desc" }, take: 1000, select: { id: true, email: true, locale: true, countryCode: true, status: true, createdAt: true, confirmedAt: true, unsubscribedAt: true } }),
    prisma.newsletterSubscriber.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<"PENDING" | "CONFIRMED" | "UNSUBSCRIBED", number>> };
}

export async function deleteSubscriber(ctx: Ctx, id: string) {
  staff(ctx);
  const s = await prisma.newsletterSubscriber.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "landing.subscriber_deleted", entityType: "NewsletterSubscriber", entityId: id, after: { email: s.email.replace(/^(.).*@/, "$1***@") } });
}

export async function exportSubscribers(ctx: Ctx) {
  staff(ctx);
  const rows = await prisma.newsletterSubscriber.findMany({ where: { status: "CONFIRMED" }, orderBy: { confirmedAt: "asc" } });
  const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["email,language,country,confirmed", ...rows.map((r) => [r.email, r.locale, r.countryCode ?? "", r.confirmedAt?.toISOString() ?? ""].map(esc).join(","))].join("\n");
}

/** FIRINGI's editor: every text key with its English text and the chosen language's translation and own wording. */
export async function landingEditor(ctx: Ctx, locale: string) {
  staff(ctx, false);
  const s = await landingSettings();
  const loc = (UI_LOCALES as readonly string[]).includes(locale) ? locale : "en";
  const [msgs, msgsEn] = await Promise.all([landingMessages(loc), landingMessages("en")]);
  const own = s.texts[loc] ?? {};
  const keys = [...new Set([...Object.keys(msgsEn), ...Object.keys(own)])];
  return { settings: s, locale: loc, rows: keys.map((k) => ({ key: k, en: msgsEn[k] ?? "", built: msgs[k] ?? "", own: own[k] ?? null })) };
}
