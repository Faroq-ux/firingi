import "server-only";
/**
 * Footer pages (FIRINGI only): sustainability and careers. FIRINGI writes the texts and job openings in the landing
 * editor and switches each page on or off; visitors apply from /careers (no files — a link to a CV / profile);
 * FIRINGI sees the applications, changes their status and deletes them (GDPR).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { UI_LOCALES } from "@/i18n/config";
import { APPLICATION_STATUSES, checkApplication, cleanLanding, listItems, lookup, type AboutPage, type ApplicationIn, type LandingSettings } from "@/lib/landing";
import { ipHash, landingSettings, landingTexts } from "./service";

const KEY = "landing.settings";
function staff(ctx: Ctx, manage = true) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.marketing.manage" : ["admin.marketing.view", "admin.marketing.manage"])) throw new ForbiddenError();
}

/** FIRINGI saves the two pages (on/off, texts) and the job openings. */
export async function saveAboutSettings(ctx: Ctx, i: Pick<LandingSettings, "about" | "jobs" | "careersEmail">) {
  staff(ctx);
  const before = await landingSettings();
  let v: LandingSettings;
  try { v = cleanLanding({ ...before, about: i.about, jobs: i.jobs, careersEmail: i.careersEmail }, UI_LOCALES); } catch (e) { throw new ValidationError((e as Error).message); }
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    update: { value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "landing.about_saved", entityType: "Setting", entityId: KEY, after: { on: { sustainability: v.about.sustainability.on, careers: v.about.careers.on }, jobs: v.jobs.length } });
  return v;
}

/** A footer page for visitors: on/off, FIRINGI's text in this language (else English, else the starting text). */
export async function aboutPage(page: AboutPage, locale: string) {
  const s = await landingSettings();
  const a = s.about[page];
  const src = await landingTexts(locale, s);
  const own = a.text[locale]?.trim() || a.text[locale.split("-")[0]]?.trim() || a.text.en?.trim() || "";
  return { on: a.on, text: own || startingText(src, page), jobs: page === "careers" ? s.jobs.filter((j) => j.on) : [] };
}
/** The built-in starting text of a page in a language (its paragraphs). */
export function startingText(src: Awaited<ReturnType<typeof landingTexts>>, page: AboutPage) {
  return listItems(src, `about.${page}.start`, []).map((n) => lookup(src, `about.${page}.start.${n}`)).join("\n\n");
}
export async function startingTexts(locales: string[]) {
  const s = await landingSettings();
  const out = { sustainability: {} as Record<string, string>, careers: {} as Record<string, string> };
  for (const l of locales) { const src = await landingTexts(l, s); out.sustainability[l] = startingText(src, "sustainability"); out.careers[l] = startingText(src, "careers"); }
  return out;
}
/** Which footer pages are on (for the footer links). */
export async function aboutLinks() {
  const s = await landingSettings();
  return { sustainability: s.about.sustainability.on, careers: s.about.careers.on };
}

const hits = new Map<string, number[]>();
export type ApplyResult = { ok: true } | { ok: false; problem: "REQUIRED" | "EMAIL" | "CONSENT" | "SPAM" | "LINK" | "BUSY" | "OFF" };
/** A visitor applies (an opening or an open application). */
export async function submitApplication(i: ApplicationIn, meta: { ip: string | null; locale: string }, now = Date.now()): Promise<ApplyResult> {
  const s = await landingSettings();
  if (!s.about.careers.on) return { ok: false, problem: "OFF" };
  const problem = checkApplication(i, now);
  if (problem) return { ok: false, problem };
  const ih = ipHash(meta.ip) ?? "none", k = `apply:${ih}`;
  const recent = (hits.get(k) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 3) return { ok: false, problem: "BUSY" };
  hits.set(k, [...recent, now]);
  const job = s.jobs.find((j) => j.id === i.jobId && j.on);
  const clip = (x: string, n: number) => x.trim().slice(0, n);
  const src = await landingTexts(meta.locale, s);
  const a = await prisma.jobApplication.create({
    data: {
      jobId: job?.id ?? "", jobTitle: job?.title ?? "", name: clip(i.name, 120), email: clip(i.email, 254).toLowerCase(), phone: clip(i.phone, 40) || null,
      link: clip(i.link, 500) || null, message: clip(i.message, 4000) || null, locale: meta.locale, consentText: lookup(src, "about.careers.consent"), ipHash: ipHash(meta.ip),
    },
  });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  const { notify } = await import("@/server/notify/dispatch");
  if (admin) await notify("website.job_application", [{ companyId: admin.id, link: "/admin/marketing/careers" }], { name: a.name, job: a.jobTitle || "—" }).catch(() => null);
  const { sendMail } = await import("@/server/services/mailer");
  await sendMail({ to: a.email, subject: lookup(src, "about.careers.mailSubject"), text: [lookup(src, "mail.hello").replace("{name}", a.name), lookup(src, "about.careers.mailBody"), lookup(src, "mail.sign")].join("\n\n") }).catch(() => null);
  if (s.careersEmail) await sendMail({ to: s.careersEmail, subject: `Job application: ${a.jobTitle || "open application"} — ${a.name}`, text: [`${a.name} · ${a.email}${a.phone ? ` · ${a.phone}` : ""}`, a.link ? `CV / profile: ${a.link}` : null, `Language: ${a.locale}`, "", a.message ?? ""].filter((x) => x !== null).join("\n") }).catch(() => null);
  return { ok: true };
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function applications(ctx: Ctx, f: { status?: string; job?: string } = {}) {
  staff(ctx, false);
  const where: Prisma.JobApplicationWhereInput = {
    ...(f.status && (APPLICATION_STATUSES as readonly string[]).includes(f.status) ? { status: f.status } : {}),
    ...(f.job !== undefined && f.job !== "ALL" ? { jobId: f.job } : {}),
  };
  const [rows, byStatus] = await Promise.all([
    prisma.jobApplication.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.jobApplication.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { rows, counts: Object.fromEntries(byStatus.map((x) => [x.status, x._count._all])) as Record<string, number> };
}
export async function setApplicationStatus(ctx: Ctx, id: string, status: string, note?: string | null) {
  staff(ctx);
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) throw new ValidationError("Unknown status.");
  const a = await prisma.jobApplication.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Application");
  await prisma.jobApplication.update({ where: { id }, data: { status, ...(note !== undefined ? { note: note?.trim().slice(0, 1000) || null } : {}) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "careers.application_status", entityType: "JobApplication", entityId: id, before: { status: a.status }, after: { status } });
  return { ok: true };
}
/** GDPR: removed for good (the audit keeps only that it happened). */
export async function deleteApplication(ctx: Ctx, id: string) {
  staff(ctx);
  const a = await prisma.jobApplication.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Application");
  await prisma.jobApplication.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "careers.application_deleted", entityType: "JobApplication", entityId: id });
  return { ok: true };
}
