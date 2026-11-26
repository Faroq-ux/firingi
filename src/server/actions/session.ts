"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { getContext, loadContext } from "@/server/context";
import { homeFor } from "@/server/rbac/guard";
import { allowedLocales } from "@/server/data/geo";
import { writeAudit } from "@/server/services/audit";
import { LOCALE_COOKIE } from "@/i18n/config";

/** Switch the company the user acts for (users can belong to several). */
export async function switchCompanyAction(companyId: string) {
  const ctx = await getContext();
  if (!ctx) return { ok: false as const, error: "Please sign in." };
  if (!ctx.memberships.some((m) => m.companyId === companyId)) return { ok: false as const, error: "Not a member of that company." };
  await prisma.session.update({ where: { id: ctx.sessionId }, data: { activeCompanyId: companyId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: companyId, action: "session.company_switched", entityType: "Company", entityId: companyId });
  const next = await loadContext(ctx.user.id, ctx.sessionId, companyId);
  revalidatePath("/", "layout");
  return { ok: true as const, redirectTo: next ? homeFor(next) : "/" };
}

/** Change UI language — only the company country's languages + English are allowed. */
export async function setLocaleAction(locale: string) {
  const parsed = z.string().max(10).safeParse(locale);
  if (!parsed.success) return { ok: false as const };
  const ctx = await getContext();
  const allowed = await allowedLocales(ctx?.company.countryId ?? null);
  if (!allowed.some((l) => l.code === parsed.data)) return { ok: false as const };
  (await cookies()).set(LOCALE_COOKIE, parsed.data, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  if (ctx) await prisma.user.update({ where: { id: ctx.user.id }, data: { locale: parsed.data } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Called right after sign-in: set the language cookie and tell the client where to go. */
export async function afterLoginAction() {
  const ctx = await getContext();
  if (!ctx) return { redirectTo: "/no-access" };
  const allowed = await allowedLocales(ctx.company.countryId);
  const locale = ctx.user.locale && allowed.some((l) => l.code === ctx.user.locale) ? ctx.user.locale : allowed[0]?.code ?? "en";
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return { redirectTo: homeFor(ctx) };
}

