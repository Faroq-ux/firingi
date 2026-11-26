import "server-only";
/**
 * Services (Phase 68): the catalogue FIRINGI keeps (built-in services + the ones FIRINGI adds, each with its
 * schedules, unit, waste code, documents, prices and who invoices the customer) and the providers FIRINGI approves
 * (suppliers on FIRINGI, or FIRINGI itself) with their licence, countries and invoicing / commission.
 */
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { BUILT_IN_NAMES, BUILT_IN_SERVICES, FREQUENCIES, INVOICED_BY, SERVICE_UNITS, type Frequency, type InvoicedBy, type Pricing } from "@/lib/services";
import { providerOn, servicesSettings } from "./settings";

const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
export const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
function assertStaff(ctx: Ctx, manage = false) {
  if (!isStaff(ctx) || !can(ctx, manage ? ["admin.services.manage", "admin.settings.manage"] : ["admin.services.view", "admin.services.manage", "admin.settings.manage"])) throw new ForbiddenError();
}

let ensured = false;
/** The built-in services exist (FIRINGI can switch them off or change their prices). */
export async function ensureBuiltIns() {
  if (ensured) return;
  for (const [i, t] of BUILT_IN_SERVICES.entries()) {
    const { code, ...rest } = t;
    const names = BUILT_IN_NAMES[code] ?? { en: code };
    const have = await prisma.serviceType.findUnique({ where: { code }, select: { id: true, name: true } });
    // FIRINGI's own names win; missing languages are filled in
    if (have) { const cur = (have.name ?? {}) as Record<string, string>; if (Object.keys(names).some((k) => !cur[k])) await prisma.serviceType.update({ where: { id: have.id }, data: { name: { ...names, ...cur } } }).catch(() => null); }
    else await prisma.serviceType.create({ data: { code, name: names, sort: i, ...rest, frequencies: rest.frequencies } }).catch(() => null);
  }
  ensured = true;
}

export type TypeRow = Awaited<ReturnType<typeof prisma.serviceType.findFirstOrThrow>>;
export const pricingOf = (t: TypeRow, p?: { invoicedBy: string | null; commissionPct: { toString(): string } | null } | null): Pricing & { invoicedBy: InvoicedBy } => ({
  feeNet: n(t.feeNet), pricePerUnit: n(t.pricePerUnit), buybackPerUnit: n(t.buybackPerUnit), providerPerVisit: n(t.providerPerVisit), providerPerUnit: n(t.providerPerUnit),
  commissionPct: p?.commissionPct != null ? n(p.commissionPct) : n(t.commissionPct), commissionPerVisit: n(t.commissionPerVisit), commissionPerUnit: n(t.commissionPerUnit),
  invoicedBy: ((p?.invoicedBy ?? t.invoicedBy) as InvoicedBy) ?? "FIRINGI",
});

// ── catalogue ───────────────────────────────────────────────────────────────

export async function listTypes(ctx: Ctx, f: { all?: boolean } = {}) {
  await ensureBuiltIns();
  if (f.all) assertStaff(ctx);
  const rows = await prisma.serviceType.findMany({ where: f.all ? {} : { active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], include: { _count: { select: { plans: { where: { status: "ACTIVE" } }, providers: { where: { status: "APPROVED" } } } } } });
  const cc = ctx.company.countryCode;
  return rows.filter((t) => f.all || !t.countries.length || t.countries.includes(cc));
}

export type TypeInput = {
  code: string; name: string; namePt?: string | null; description?: string | null; kind: "COLLECTION" | "VISIT" | "PRINT"; allowExtras?: boolean; unit: string; isOil: boolean; wasteCode?: string | null; needsDocument: boolean;
  frequencies: string[]; feeNet: number; pricePerUnit: number; buybackPerUnit: number; providerPerVisit: number; providerPerUnit: number;
  invoicedBy: string; commissionPct: number; commissionPerVisit: number; commissionPerUnit: number; countries: string[]; active: boolean;
};
export async function saveType(ctx: Ctx, id: string | null, i: TypeInput) {
  assertStaff(ctx, true);
  const code = i.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40);
  if (code.length < 3) throw new ValidationError("Give the service a code (letters, numbers, _).");
  if (!i.name.trim()) throw new ValidationError("Name the service.");
  const freq = [...new Set(i.frequencies.filter((x) => (FREQUENCIES as readonly string[]).includes(x)))];
  if (!freq.length && i.kind !== "PRINT") throw new ValidationError("Allow at least one schedule (or 'only when requested').");
  if (!(SERVICE_UNITS as readonly string[]).includes(i.unit)) throw new ValidationError("Unknown unit.");
  if (!(INVOICED_BY as readonly string[]).includes(i.invoicedBy)) throw new ValidationError("Choose who invoices the customer.");
  for (const k of ["feeNet", "pricePerUnit", "buybackPerUnit", "providerPerVisit", "providerPerUnit", "commissionPerVisit", "commissionPerUnit"] as const) if (!(i[k] >= 0)) throw new ValidationError("Amounts can't be negative.");
  if (!(i.commissionPct >= 0 && i.commissionPct <= 100)) throw new ValidationError("Commission: 0 to 100 %.");
  const before = id ? await prisma.serviceType.findUnique({ where: { id } }) : null;
  if (id && !before) throw new NotFoundError("Service");
  const name = { ...((before?.name as Record<string, string>) ?? {}), en: i.name.trim().slice(0, 120), ...(i.namePt?.trim() ? { "pt-PT": i.namePt.trim().slice(0, 120) } : {}) };
  const data = {
    name, description: i.description?.trim() ? { en: i.description.trim().slice(0, 1000) } : undefined, kind: i.kind, allowExtras: i.kind === "VISIT" && !!i.allowExtras, unit: i.unit, isOil: i.isOil, wasteCode: i.wasteCode?.trim() || null, needsDocument: i.needsDocument,
    frequencies: freq, feeNet: i.feeNet, pricePerUnit: i.pricePerUnit, buybackPerUnit: i.buybackPerUnit, providerPerVisit: i.providerPerVisit, providerPerUnit: i.providerPerUnit,
    invoicedBy: i.invoicedBy, commissionPct: i.commissionPct, commissionPerVisit: i.commissionPerVisit, commissionPerUnit: i.commissionPerUnit,
    countries: [...new Set(i.countries.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))], active: i.active,
  };
  const t = before
    ? await prisma.serviceType.update({ where: { id: before.id }, data: data as Prisma.ServiceTypeUpdateInput })
    : await prisma.serviceType.create({ data: { ...data, code, createdById: ctx.user.id } as Prisma.ServiceTypeCreateInput }).catch((e: { code?: string }) => { if (e.code === "P2002") throw new ValidationError("A service with this code exists."); throw e; });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: before ? "services.type_changed" : "services.type_created", entityType: "ServiceType", entityId: t.id, before: before as unknown as Prisma.InputJsonValue, after: t as unknown as Prisma.InputJsonValue });
  return t;
}

// ── providers ───────────────────────────────────────────────────────────────

export async function listProviders(ctx: Ctx, f: { serviceTypeId?: string; status?: string } = {}) {
  if (isStaff(ctx)) assertStaff(ctx);
  else if (!can(ctx, ["vendor.services.manage", "vendor.services.visit"])) throw new ForbiddenError();
  const rows = await prisma.serviceProvider.findMany({
    where: { ...(isStaff(ctx) ? {} : { companyId: ctx.company.id }), ...(f.serviceTypeId ? { serviceTypeId: f.serviceTypeId } : {}), ...(f.status ? { status: f.status } : {}) },
    include: { serviceType: true, _count: { select: { plans: { where: { status: "ACTIVE" } } } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const cos = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, legalName: true, tradeName: true, type: true } });
  return rows.map((r) => ({ ...r, company: nameOf(cos.find((c) => c.id === r.companyId)), companyType: cos.find((c) => c.id === r.companyId)?.type ?? "—", pricing: pricingOf(r.serviceType, r) }));
}

/** A supplier asks to provide a service (FIRINGI approves). */
export async function applyProvider(ctx: Ctx, i: { serviceTypeId: string; countries: string[]; licenceNumber?: string | null; licenceExpiresAt?: Date | null; note?: string | null }) {
  if (isStaff(ctx) || !can(ctx, "vendor.services.manage")) throw new ForbiddenError();
  if (!providerOn(await servicesSettings(), ctx.company)) throw new ForbiddenError("FIRINGI hasn't opened services to your company.");
  const t = await prisma.serviceType.findUnique({ where: { id: i.serviceTypeId } });
  if (!t || !t.active) throw new NotFoundError("Service");
  if (t.needsDocument && !i.licenceNumber?.trim()) throw new ValidationError("This service needs a licence number (waste operator / pest control licence).");
  const countries = [...new Set(i.countries.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  if (!countries.length) countries.push(ctx.company.countryCode);
  const existing = await prisma.serviceProvider.findUnique({ where: { companyId_serviceTypeId: { companyId: ctx.company.id, serviceTypeId: t.id } } });
  if (existing && existing.status === "APPROVED") throw new ValidationError("You already provide this service.");
  const data = { countries, licenceNumber: i.licenceNumber?.trim() || null, licenceExpiresAt: i.licenceExpiresAt ?? null, note: i.note?.trim().slice(0, 500) || null, status: "PENDING", decidedAt: null, decidedById: null, decisionNote: null };
  const p = existing
    ? await prisma.serviceProvider.update({ where: { id: existing.id }, data })
    : await prisma.serviceProvider.create({ data: { ...data, companyId: ctx.company.id, serviceTypeId: t.id, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.provider_applied", entityType: "ServiceProvider", entityId: p.id, after: { serviceTypeId: t.id, countries } });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (admin) {
    const { notify } = await import("@/server/notify/dispatch");
    await notify("service.provider_review", [{ companyId: admin.id, link: "/admin/services?tab=PROVIDERS" }], { company: nameOf(ctx.company), service: String((t.name as Record<string, string>).en ?? t.code) }).catch(() => null);
  }
  return p;
}

export async function decideProvider(ctx: Ctx, id: string, i: { approve: boolean; note?: string | null; invoicedBy?: string | null; commissionPct?: number | null; status?: "SUSPENDED" }) {
  assertStaff(ctx, true);
  const p = await prisma.serviceProvider.findUnique({ where: { id }, include: { serviceType: true } });
  if (!p) throw new NotFoundError("Provider");
  if (i.invoicedBy && !(INVOICED_BY as readonly string[]).includes(i.invoicedBy)) throw new ValidationError("Choose who invoices the customer.");
  if (i.commissionPct != null && !(i.commissionPct >= 0 && i.commissionPct <= 100)) throw new ValidationError("Commission: 0 to 100 %.");
  const status = i.status ?? (i.approve ? "APPROVED" : "REJECTED");
  const u = await prisma.serviceProvider.update({
    where: { id }, data: { status, decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: i.note?.trim().slice(0, 500) || null, invoicedBy: i.invoicedBy === undefined ? p.invoicedBy : i.invoicedBy || null, commissionPct: i.commissionPct === undefined ? p.commissionPct : i.commissionPct === null ? null : new Decimal(i.commissionPct) },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "services.provider_decided", entityType: "ServiceProvider", entityId: id, before: { status: p.status, invoicedBy: p.invoicedBy }, after: { status, invoicedBy: u.invoicedBy, commissionPct: u.commissionPct?.toString() ?? null } });
  if (p.companyId !== ctx.company.id) {
    const { notify } = await import("@/server/notify/dispatch");
    await notify("service.provider_decided", [{ companyId: p.companyId, link: "/vendor/services" }], { decision: status, note: i.note ?? "" }).catch(() => null);
  }
  return u;
}

/** FIRINGI provides a service itself (its own fleet / team): approved at once. */
export async function addFiringiProvider(ctx: Ctx, serviceTypeId: string, countries: string[]) {
  assertStaff(ctx, true);
  const t = await prisma.serviceType.findUnique({ where: { id: serviceTypeId } });
  if (!t) throw new NotFoundError("Service");
  const cs = [...new Set(countries.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  return prisma.serviceProvider.upsert({
    where: { companyId_serviceTypeId: { companyId: ctx.company.id, serviceTypeId } },
    update: { status: "APPROVED", countries: cs, decidedById: ctx.user.id, decidedAt: new Date(), invoicedBy: "FIRINGI" },
    create: { companyId: ctx.company.id, serviceTypeId, status: "APPROVED", countries: cs, decidedById: ctx.user.id, decidedAt: new Date(), invoicedBy: "FIRINGI", createdById: ctx.user.id },
  });
}

/** The approved provider for a customer's country with the fewest active plans (licence still valid). */
export async function pickProvider(serviceTypeId: string, countryCode: string, now = new Date()) {
  const ps = await prisma.serviceProvider.findMany({
    where: { serviceTypeId, status: "APPROVED", OR: [{ licenceExpiresAt: null }, { licenceExpiresAt: { gt: now } }] },
    include: { _count: { select: { plans: { where: { status: "ACTIVE" } } } } },
  });
  const ok = ps.filter((p) => !p.countries.length || p.countries.includes(countryCode)).sort((a, b) => a._count.plans - b._count.plans);
  return ok[0] ?? null;
}
export const allowedFrequency = (t: { frequencies: string[] }, f: string): f is Frequency => t.frequencies.includes(f);
