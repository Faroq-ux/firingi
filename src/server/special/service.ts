/** Phase 47e — special goods access (see src/lib/special-access.ts): settings, per-company verdicts, checks, exceptions. */
import "server-only";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { categoryInfo } from "@/server/catalogue/restrictions";
import { mergeSpecialSettings, SPECIAL_KINDS, verdict, type SpecialCompany, type SpecialKind, type SpecialSettings, type SpecialTarget, type SpecialVerdict } from "@/lib/special-access";

const KEY = "special.access";

export async function specialSettings(db: Tx | typeof prisma = prisma): Promise<SpecialSettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeSpecialSettings(row?.value ?? null);
}

export async function saveSpecialSettings(ctx: Ctx, raw: unknown) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const value = mergeSpecialSettings(raw);
  for (const r of value.rules) if (r.target.startsWith("cat:") && !(await prisma.category.count({ where: { id: r.target.slice(4) } }))) throw new ValidationError(`Unknown category in rule "${r.label}".`);
  const before = await specialSettings();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: value as never, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: value as never, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "special.settings", entityType: "Setting", entityId: KEY, before: before as never, after: value as never });
  return value;
}

async function companyFacts(companyId: string, db: Tx | typeof prisma = prisma): Promise<SpecialCompany> {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { activityCode: true, activityCodes: true, sellsRestricted: true, restrictedDeclared: true, country: { select: { code: true } }, specialAccessExceptions: { select: { target: true } } } });
  return { country: c.country.code, codes: [c.activityCode, ...c.activityCodes].filter((x): x is string => !!x), declared: c.restrictedDeclared, sells: c.sellsRestricted, exceptions: c.specialAccessExceptions.map((e) => e.target) };
}

/** Each target's verdict for a company (kinds + category rules). */
export async function specialAccess(companyId: string, db: Tx | typeof prisma = prisma) {
  const [s, c] = await Promise.all([specialSettings(db), companyFacts(companyId, db)]);
  const targets: SpecialTarget[] = [...SPECIAL_KINDS, ...s.rules.filter((r) => r.target.startsWith("cat:")).map((r) => r.target)];
  const out = new Map<SpecialTarget, SpecialVerdict>();
  for (const t of [...new Set(targets)]) out.set(t, verdict(s, c, t));
  return { settings: s, company: c, verdicts: out };
}

/** What the catalogue hides: closed kinds, and closed special categories (with their sub-categories). */
export async function specialBlocks(companyId: string, info: Map<string, { ancestors: string[] }>) {
  const { verdicts } = await specialAccess(companyId);
  const kinds = new Set<SpecialKind>();
  const cats = new Set<string>();
  for (const [t, v] of verdicts) {
    if (v.open) continue;
    if (t.startsWith("cat:")) { const id = t.slice(4); for (const [cid, i] of info) if (cid === id || i.ancestors.includes(id)) cats.add(cid); }
    else kinds.add(t as SpecialKind);
  }
  return { kinds, cats };
}

const KIND_LABEL: Record<SpecialKind, string> = { TOBACCO: "tobacco", ALCOHOL: "alcoholic drinks", VAPING: "vaping products" };

/** Cart and checkout: refuse items the company may not buy (an old cart, a direct link). */
export async function assertSpecialItems(companyId: string, offerIds: string[], db: Tx | typeof prisma = prisma) {
  if (!offerIds.length) return;
  const { verdicts, settings } = await specialAccess(companyId, db);
  if (!settings.enabled || [...verdicts.values()].every((v) => v.open)) return;
  const offers = await db.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, exciseCategory: { select: { kind: true } }, packaging: { select: { variant: { select: { product: { select: { name: true, restriction: true, categoryId: true } } } } } } } });
  const cats = await db.category.findMany({ select: { id: true, parentId: true, restriction: true, isActive: true } });
  const info = categoryInfo(cats);
  for (const o of offers) {
    const p = o.packaging.variant.product;
    const ci = info.get(p.categoryId);
    const kinds = new Set<SpecialKind>();
    const r = p.restriction ?? ci?.restriction ?? null;
    if (r === "TOBACCO" || r === "ALCOHOL") kinds.add(r);
    const ek = o.exciseCategory?.kind;
    if (ek === "TOBACCO" || ek === "ALCOHOL" || ek === "VAPING") kinds.add(ek);
    for (const k of kinds) if (!verdicts.get(k)?.open) throw new AppError("SPECIAL_ACCESS", `Your business can't buy ${KIND_LABEL[k]}: ${reasonText(verdicts.get(k)!.reason, KIND_LABEL[k])}`, 422, { offerId: o.id, target: k });
    for (const id of [p.categoryId, ...(ci?.ancestors ?? [])]) {
      const v = verdicts.get(`cat:${id}`);
      if (v && !v.open) throw new AppError("SPECIAL_ACCESS", `Your business can't buy this item: ${reasonText(v.reason, "these items")}`, 422, { offerId: o.id, target: `cat:${id}` });
    }
  }
}

function reasonText(r: SpecialVerdict["reason"], what: string) {
  return r === "NOT_DECLARED" ? `you didn't say you sell ${what} (Company › Profile).` : r === "NO_CODE" ? "add your activity code (CAE) in Company › Profile." : `none of your activity codes (CAE) is one that sells ${what}. Add the right code or contact FIRINGI support.`;
}

/** FIRINGI lets one company through (or takes it back). */
export async function setSpecialException(ctx: Ctx, companyId: string, target: SpecialTarget, on: boolean, note?: string | null) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.customers.approve", "admin.vendors.approve", "admin.risk.manage"])) throw new ForbiddenError();
  if (!(await prisma.company.count({ where: { id: companyId } }))) throw new NotFoundError("Company");
  if (on) {
    if (!note || note.trim().length < 5) throw new ValidationError("Give the reason for the exception.");
    await prisma.specialAccessException.upsert({ where: { companyId_target: { companyId, target } }, update: { note: note.trim().slice(0, 300), createdById: ctx.user.id }, create: { companyId, target, note: note.trim().slice(0, 300), createdById: ctx.user.id } });
  } else await prisma.specialAccessException.deleteMany({ where: { companyId, target } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: on ? "special.exception_granted" : "special.exception_removed", entityType: "Company", entityId: companyId, after: { target, note: note ?? null } });
}

/** The company states which special goods it sells (registration, later in the profile). */
export async function setOwnSpecialGoods(ctx: Ctx, kinds: string[]) {
  if (!can(ctx, "company.profile.manage")) throw new ForbiddenError();
  const sells = [...new Set(kinds.filter((k) => (SPECIAL_KINDS as readonly string[]).includes(k)))];
  const before = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { sellsRestricted: true } });
  await prisma.company.update({ where: { id: ctx.company.id }, data: { sellsRestricted: sells, restrictedDeclared: true } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "special.declared", entityType: "Company", entityId: ctx.company.id, before: { sells: before.sellsRestricted }, after: { sells } });
  return { sells };
}

/** For the admin company page and the buyer's own page. */
export async function specialOverview(companyId: string) {
  const { verdicts, company, settings } = await specialAccess(companyId);
  const cats = await prisma.category.findMany({ where: { id: { in: settings.rules.filter((r) => r.target.startsWith("cat:")).map((r) => r.target.slice(4)) } }, select: { id: true, name: true } });
  const exc = await prisma.specialAccessException.findMany({ where: { companyId }, select: { target: true, note: true, createdAt: true } });
  return {
    enabled: settings.enabled, codes: company.codes, declared: company.declared, sells: company.sells,
    rows: [...verdicts].map(([target, v]) => ({ target, ...v, label: settings.rules.find((r) => r.target === target)?.label ?? target, category: target.startsWith("cat:") ? cats.find((c) => c.id === target.slice(4))?.name ?? null : null, exception: exc.find((e) => e.target === target) ?? null })),
  };
}

/** Catalogue categories for "special items" rules (admin settings page). */
export async function specialCategoryOptions(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const cats = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true, path: true }, orderBy: { path: "asc" } });
  return cats.map((c) => ({ id: c.id, depth: c.depth, name: typeof c.name === "string" ? c.name : ((c.name as Record<string, string>)?.en ?? Object.values((c.name as Record<string, string>) ?? {})[0] ?? c.id) }));
}
