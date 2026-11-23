"use server";
/** Landing page actions (Phase 56). The visitors' forms need no sign-in; the service checks, limits and records them. */
import { z } from "zod";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as L from "@/server/landing/service";
import { ABOUT_PAGES, APPLICATION_STATUSES, JOB_TYPES, LANDING_SECTIONS, LEGAL_PAGES, SOCIALS } from "@/lib/landing";
import { LOCALE_COOKIE, UI_LOCALES } from "@/i18n/config";

async function visitor() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const c = await cookies();
  return { ip, locale: c.get(LOCALE_COOKIE)?.value ?? "en", acceptLanguage: h.get("accept-language") ?? "" };
}
const short = (n: number) => z.string().max(n).default("");

const ContactSchema = z.object({
  kind: z.enum(["QUESTION", "VENDOR"]), name: short(120), company: short(160), email: short(254), phone: short(40), nif: short(20), type: short(80),
  message: short(4000), consent: z.boolean(), website: short(200), startedAt: z.number(),
  vendorType: z.enum(["WHOLESALER", "DISTRIBUTOR"]).optional(),
});

/** A visitor's question or vendor application → a CRM lead. */
export async function submitContactAction(input: unknown) {
  const p = ContactSchema.safeParse(input);
  if (!p.success) return { ok: false as const, problem: "REQUIRED" as const };
  const v = await visitor();
  return L.submitContact(p.data, v);
}

const ApplySchema = z.object({ jobId: short(40), name: short(120), email: short(254), phone: short(40), link: short(500), message: short(4000), consent: z.boolean(), website: short(200), startedAt: z.number() });
/** A job application for FIRINGI (careers page; no sign-in). */
export async function submitApplicationAction(input: unknown) {
  const p = ApplySchema.safeParse(input);
  if (!p.success) return { ok: false as const, problem: "REQUIRED" as const };
  const v = await visitor();
  return (await import("@/server/landing/careers")).submitApplication(p.data, v);
}

/** Newsletter sign-up: an e-mail asks the visitor to confirm. */
export async function subscribeNewsletterAction(input: unknown) {
  const p = z.object({ email: short(254), consent: z.boolean(), website: short(200), startedAt: z.number() }).safeParse(input);
  if (!p.success) return { ok: false as const, problem: "EMAIL" as const };
  const v = await visitor();
  return L.subscribeNewsletter(p.data, v);
}

/** The landing page's language switch (any interface language; signed-in users keep their own choice in the app). */
export async function setLandingLocaleAction(locale: string) {
  if (!(UI_LOCALES as readonly string[]).includes(locale)) return { ok: false as const };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────
const MKT = ["admin.marketing.manage"] as const;
const done = <T>(v: T) => { revalidatePath("/", "layout"); revalidatePath("/admin/marketing/landing"); return v; };
const textMap = z.record(z.string().max(80), z.string().max(4000));

export const saveLandingSettingsAction = defineAction({
  permission: [...MKT],
  schema: z.object({
    enabled: z.boolean(), sections: z.record(z.enum(LANDING_SECTIONS), z.boolean()),
    whatsapp: z.string().max(30), whatsappVendors: z.string().max(30), email: z.string().max(254), phone: z.string().max(40),
    company: z.object({ legalName: z.string().max(300), nif: z.string().max(300), address: z.string().max(300) }),
    social: z.record(z.enum(SOCIALS), z.string().max(500)), livroUrl: z.string().max(500),
    texts: z.record(z.string().max(10), textMap), hidden: z.array(z.string().max(80)).max(500),
    legal: z.record(z.enum(LEGAL_PAGES), z.record(z.string().max(10), z.string().max(60000))),
    legalUpdated: z.record(z.enum(LEGAL_PAGES), z.string().max(20).nullable()),
  }),
  handler: async (ctx, i) => done(await L.saveLandingSettings(ctx, i as Parameters<typeof L.saveLandingSettings>[1])),
});
export const deleteSubscriberAction = defineAction({
  permission: [...MKT], schema: z.object({ id: z.string().min(1).max(64) }),
  handler: async (ctx, i) => { await L.deleteSubscriber(ctx, i.id); revalidatePath("/admin/marketing/newsletter"); return true; },
});

// ── footer pages: sustainability, careers (FIRINGI only) ────────────────────
const careers = () => import("@/server/landing/careers");
const reCareers = <T>(v: T) => { revalidatePath("/sustainability"); revalidatePath("/careers"); revalidatePath("/", "layout"); revalidatePath("/admin/marketing/careers"); return v; };
export const saveAboutSettingsAction = defineAction({
  permission: [...MKT],
  schema: z.object({
    about: z.record(z.enum(ABOUT_PAGES), z.object({ on: z.boolean(), text: z.record(z.string().max(10), z.string().max(30000)) })),
    jobs: z.array(z.object({ id: z.string().max(40), title: z.string().max(200), location: z.string().max(200), type: z.enum(JOB_TYPES), text: z.string().max(8000), on: z.boolean() })).max(50),
    careersEmail: z.string().max(254),
  }),
  handler: async (ctx, i) => { await (await careers()).saveAboutSettings(ctx, i as never); return reCareers({ ok: true }); },
});
export const setApplicationStatusAction = defineAction({
  permission: [...MKT], schema: z.object({ id: z.string().min(1).max(40), status: z.enum(APPLICATION_STATUSES), note: z.string().max(1000).nullable().optional() }),
  handler: async (ctx, i) => reCareers(await (await careers()).setApplicationStatus(ctx, i.id, i.status, i.note)),
});
export const deleteApplicationAction = defineAction({
  permission: [...MKT], schema: z.object({ id: z.string().min(1).max(40) }),
  handler: async (ctx, i) => reCareers(await (await careers()).deleteApplication(ctx, i.id)),
});
