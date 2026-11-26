/**
 * Buying groups (Phase 49). Small restaurants and shops (customers) and wholesalers buying from distributors pool their
 * purchases:
 *   • a business starts a group (FIRINGI approves it, or AUTO) and is its first admin;
 *   • members join by invitation (by NIF / VAT number) or by asking to join an open group; a business may be in
 *     several groups when FIRINGI allows it;
 *   • suppliers give a group its own prices — a supplier-owned customer group linked to the buying group (members kept
 *     in step) with a price list, so the normal pricing applies them;
 *   • rebate deals for a buying group count the whole group's purchases (src/server/rebates/service.ts), the bonus is
 *     shared by what each member bought;
 *   • group order rounds: members add to a shared order with one supplier until it closes; each member's own order is
 *     placed then (FIRINGI still invoices each member), all for the same delivery day;
 *   • reports: the group's purchases, by member and supplier, and the bonuses earned together.
 * Every part is FIRINGI's switch (Admin › Customers › Buying Groups), per member type and per company.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { cleanGroupSettings, mergeGroupSettings, type GroupFeature, type GroupSettings } from "@/lib/buying-groups";

const KEY = "groups.settings";
const FEATURE = "BUYING_GROUPS";
const DAY = 86_400_000;
const isBuyer = (t: string) => t === "CUSTOMER" || t === "WHOLESALER";
const nameOf = (c: { tradeName: string | null; legalName: string }) => c.tradeName ?? c.legalName;
const pick = (n: unknown) => (typeof n === "string" ? n : ((n as Record<string, string> | null)?.en ?? Object.values((n as Record<string, string>) ?? {})[0] ?? ""));
const LIVE: Prisma.BuyingGroupMemberWhereInput = { status: "ACTIVE" };

// ── settings & switches ─────────────────────────────────────────────────────

export async function groupSettings(): Promise<GroupSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeGroupSettings(row?.value as Partial<GroupSettings> | null);
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? ["admin.customers.manage", "admin.settings.manage"] : ["admin.customers.view", "admin.customers.manage", "admin.customers.approve", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function saveGroupSettings(ctx: Ctx, input: GroupSettings) {
  staff(ctx, true);
  let v: GroupSettings;
  try { v = cleanGroupSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await groupSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

export async function companySwitch(companyId: string): Promise<"DEFAULT" | "ON" | "OFF"> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setCompanySwitch(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  staff(ctx, true);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || !isBuyer(co.type)) throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

/** May this business take part in buying groups, and start one? */
export async function groupAccess(company: { id: string; type: string }, s?: GroupSettings) {
  const set = s ?? (await groupSettings());
  if (!set.enabled || !isBuyer(company.type)) return { member: false, create: false, why: "OFF" as const };
  const sw = await companySwitch(company.id);
  if (sw === "OFF") return { member: false, create: false, why: "COMPANY_OFF" as const };
  const type = company.type as "CUSTOMER" | "WHOLESALER";
  const member = sw === "ON" || set.members[type];
  return { member, create: member && (sw === "ON" || set.creators[type]), why: member ? null : ("TYPE_OFF" as const) };
}

async function assertMember(ctx: Ctx) {
  const s = await groupSettings();
  const a = await groupAccess(ctx.company, s);
  if (!a.member) throw new ForbiddenError("Buying groups aren't open for your business. Please contact FIRINGI.");
  return s;
}

function assertFeature(s: GroupSettings, f: GroupFeature) {
  if (!s.features[f]) throw new ValidationError("FIRINGI has switched this off.");
}

const manager = (ctx: Ctx) => ctx.membership.isOwner || can(ctx, ["company.profile.manage"]);

// ── groups ──────────────────────────────────────────────────────────────────

async function activeGroupsOf(companyId: string) {
  return prisma.buyingGroupMember.count({ where: { companyId, status: "ACTIVE", group: { status: { in: ["PENDING", "APPROVED"] } } } });
}

async function assertCanJoinAnother(companyId: string, s: GroupSettings) {
  if (!s.multipleGroups && (await activeGroupsOf(companyId)) > 0) throw new ValidationError("A business can belong to one buying group only.");
}

export async function createGroup(ctx: Ctx, input: { name: string; description?: string | null; open?: boolean }) {
  const s = await assertMember(ctx);
  if (!(await groupAccess(ctx.company, s)).create) throw new ForbiddenError("Your business can't start a buying group. Please contact FIRINGI.");
  if (!manager(ctx)) throw new ForbiddenError("Only the owner or a company manager can start a buying group.");
  const nm = input.name?.trim();
  if (!nm || nm.length > 80) throw new ValidationError("Give the group a name (up to 80 characters).");
  await assertCanJoinAnother(ctx.company.id, s);
  const auto = s.approval === "AUTO";
  const g = await prisma.buyingGroup.create({
    data: {
      name: nm, description: input.description?.trim() || null, open: input.open ?? true, countryId: ctx.company.countryId,
      status: auto ? "APPROVED" : "PENDING", ...(auto ? { reviewedAt: new Date(), reviewNote: "Started by itself" } : {}),
      createdByCompanyId: ctx.company.id, createdById: ctx.user.id,
      members: { create: { companyId: ctx.company.id, role: "ADMIN", status: "ACTIVE", joinedAt: new Date() } },
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.created", entityType: "BuyingGroup", entityId: g.id, after: { name: nm, status: g.status } });
  if (!auto) {
    const adminCo = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
    if (adminCo) await notify("group.review", [{ companyId: adminCo.id, link: `/admin/customers/buying-groups/${g.id}` }], { company: nameOf(ctx.company), name: nm }).catch(() => null);
  }
  return g;
}

/** The caller's membership of a group (or FIRINGI staff); throws when it may not see it. */
async function viewerOf(ctx: Ctx, groupId: string) {
  const g = await prisma.buyingGroup.findUnique({ where: { id: groupId } });
  if (!g) throw new NotFoundError("Group");
  if (ctx.company.type === "ADMIN") { staff(ctx); return { g, me: null, admin: false, firingi: true }; }
  const me = await prisma.buyingGroupMember.findUnique({ where: { groupId_companyId: { groupId, companyId: ctx.company.id } } });
  if (!me || !["ACTIVE", "INVITED", "REQUESTED"].includes(me.status)) throw new NotFoundError("Group");
  return { g, me, admin: me.status === "ACTIVE" && me.role === "ADMIN", firingi: false };
}

async function assertGroupAdmin(ctx: Ctx, groupId: string, live = true) {
  const v = await viewerOf(ctx, groupId);
  if (!v.admin || !manager(ctx)) throw new ForbiddenError("Only the group's admins can do this.");
  if (live && v.g.status !== "APPROVED") throw new ValidationError(v.g.status === "PENDING" ? "FIRINGI hasn't approved the group yet." : "This group is closed.");
  return v;
}

export async function updateGroup(ctx: Ctx, groupId: string, input: { name: string; description?: string | null; open: boolean }) {
  await assertGroupAdmin(ctx, groupId, false);
  const nm = input.name?.trim();
  if (!nm || nm.length > 80) throw new ValidationError("Give the group a name (up to 80 characters).");
  const u = await prisma.buyingGroup.update({ where: { id: groupId }, data: { name: nm, description: input.description?.trim() || null, open: !!input.open } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.updated", entityType: "BuyingGroup", entityId: groupId, after: { name: nm, open: u.open } });
  return u;
}

export async function reviewGroup(ctx: Ctx, groupId: string, approve: boolean, note: string | null) {
  staff(ctx, true);
  const g = await prisma.buyingGroup.findUnique({ where: { id: groupId } });
  if (!g) throw new NotFoundError("Group");
  if (g.status !== "PENDING") throw new ValidationError("This group isn't waiting for a decision.");
  if (!approve && !note?.trim()) throw new ValidationError("Say why (the business sees it).");
  const u = await prisma.buyingGroup.update({ where: { id: groupId }, data: { status: approve ? "APPROVED" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "groups.approved" : "groups.rejected", entityType: "BuyingGroup", entityId: groupId, after: { note } });
  await notify("group.decided", [{ companyId: g.createdByCompanyId, link: `/buy/groups/${g.id}` }], { name: g.name, decision: approve ? "APPROVED" : "REJECTED", reason: note ?? "" }).catch(() => null);
  return u;
}

/** Close a group (its admins or FIRINGI): no new members or rounds, group prices stop, open rounds are cancelled. */
export async function closeGroup(ctx: Ctx, groupId: string) {
  if (ctx.company.type === "ADMIN") staff(ctx, true); else await assertGroupAdmin(ctx, groupId, false);
  await prisma.$transaction(async (tx) => {
    await tx.buyingGroup.update({ where: { id: groupId }, data: { status: "CLOSED" } });
    await tx.groupOrderRound.updateMany({ where: { groupId, status: "OPEN" }, data: { status: "CANCELLED" } });
    await tx.priceList.updateMany({ where: { targetGroup: { buyingGroupId: groupId } }, data: { isActive: false } });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.closed", entityType: "BuyingGroup", entityId: groupId });
}

// ── members ─────────────────────────────────────────────────────────────────

async function liveCount(groupId: string) {
  return prisma.buyingGroupMember.count({ where: { groupId, status: "ACTIVE" } });
}

async function admins(groupId: string) {
  return (await prisma.buyingGroupMember.findMany({ where: { groupId, status: "ACTIVE", role: "ADMIN" }, select: { companyId: true } })).map((m) => m.companyId);
}

/** Invite a business by its NIF / VAT number (it accepts or declines). */
export async function inviteMember(ctx: Ctx, groupId: string, taxIdOrVat: string, message?: string | null) {
  const s = await assertMember(ctx);
  const { g } = await assertGroupAdmin(ctx, groupId);
  const q = taxIdOrVat.replace(/\s+/g, "").toUpperCase();
  if (q.length < 5) throw new ValidationError("Enter the business's NIF or VAT number.");
  const co = await prisma.company.findFirst({ where: { status: "APPROVED", OR: [{ taxId: { equals: q, mode: "insensitive" }, countryId: g.countryId }, { vatNumber: { equals: q, mode: "insensitive" } }, { taxId: { equals: q, mode: "insensitive" } }] }, select: { id: true, type: true, legalName: true, tradeName: true } });
  if (!co) throw new ValidationError("No business on FIRINGI with that number.");
  if (!(await groupAccess(co, s)).member) throw new ValidationError("That business can't join buying groups.");
  if ((await liveCount(groupId)) >= s.maxMembers) throw new ValidationError(`A group has at most ${s.maxMembers} members.`);
  const cur = await prisma.buyingGroupMember.findUnique({ where: { groupId_companyId: { groupId, companyId: co.id } } });
  if (cur?.status === "ACTIVE") throw new ValidationError("That business is already a member.");
  const m = cur
    ? await prisma.buyingGroupMember.update({ where: { id: cur.id }, data: { status: "INVITED", role: "MEMBER", invitedById: ctx.user.id, message: message?.trim() || null, leftAt: null } })
    : await prisma.buyingGroupMember.create({ data: { groupId, companyId: co.id, status: "INVITED", invitedById: ctx.user.id, message: message?.trim() || null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.invited", entityType: "BuyingGroup", entityId: groupId, after: { companyId: co.id } });
  await notify("group.invited", [{ companyId: co.id, link: "/buy/groups" }], { name: g.name, company: nameOf(ctx.company) }).catch(() => null);
  return { member: m, company: nameOf(co) };
}

async function activate(groupId: string, companyId: string, s: GroupSettings) {
  await assertCanJoinAnother(companyId, s);
  if ((await liveCount(groupId)) >= s.maxMembers) throw new ValidationError(`The group is full (${s.maxMembers} members).`);
  await prisma.buyingGroupMember.update({ where: { groupId_companyId: { groupId, companyId } }, data: { status: "ACTIVE", joinedAt: new Date(), leftAt: null } });
  await syncPriceGroups(groupId);
}

export async function respondInvite(ctx: Ctx, groupId: string, accept: boolean) {
  const s = await assertMember(ctx);
  if (!manager(ctx)) throw new ForbiddenError("Only the owner or a company manager can do this.");
  const { g, me } = await viewerOf(ctx, groupId);
  if (me?.status !== "INVITED") throw new ValidationError("There's no invitation to answer.");
  if (accept) {
    if (g.status !== "APPROVED" && g.status !== "PENDING") throw new ValidationError("This group is closed.");
    await activate(groupId, ctx.company.id, s);
  } else await prisma.buyingGroupMember.update({ where: { id: me.id }, data: { status: "DECLINED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: accept ? "groups.joined" : "groups.declined", entityType: "BuyingGroup", entityId: groupId });
}

/** Open groups in the business's country it can ask to join. */
export async function openGroups(ctx: Ctx, q?: string | null) {
  const s = await assertMember(ctx);
  if (!s.joinRequests) return [];
  const rows = await prisma.buyingGroup.findMany({
    where: { status: "APPROVED", open: true, countryId: ctx.company.countryId, members: { none: { companyId: ctx.company.id, status: { in: ["ACTIVE", "INVITED", "REQUESTED"] } } }, ...(q?.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}) },
    include: { _count: { select: { members: { where: LIVE } } } }, orderBy: { name: "asc" }, take: 100,
  });
  return rows.map((g) => ({ id: g.id, name: g.name, description: g.description, members: g._count.members }));
}

export async function requestJoin(ctx: Ctx, groupId: string, message?: string | null) {
  const s = await assertMember(ctx);
  if (!s.joinRequests) throw new ValidationError("FIRINGI has switched join requests off.");
  if (!manager(ctx)) throw new ForbiddenError("Only the owner or a company manager can do this.");
  const g = await prisma.buyingGroup.findFirst({ where: { id: groupId, status: "APPROVED", open: true, countryId: ctx.company.countryId } });
  if (!g) throw new NotFoundError("Group");
  await assertCanJoinAnother(ctx.company.id, s);
  const cur = await prisma.buyingGroupMember.findUnique({ where: { groupId_companyId: { groupId, companyId: ctx.company.id } } });
  if (cur && ["ACTIVE", "REQUESTED", "INVITED"].includes(cur.status)) throw new ValidationError("You already asked, are invited or are a member.");
  if (cur) await prisma.buyingGroupMember.update({ where: { id: cur.id }, data: { status: "REQUESTED", role: "MEMBER", message: message?.trim() || null, leftAt: null } });
  else await prisma.buyingGroupMember.create({ data: { groupId, companyId: ctx.company.id, status: "REQUESTED", message: message?.trim() || null } });
  for (const id of await admins(groupId)) await notify("group.join_request", [{ companyId: id, link: `/buy/groups/${groupId}` }], { name: g.name, company: nameOf(ctx.company) }).catch(() => null);
}

export async function decideRequest(ctx: Ctx, groupId: string, companyId: string, accept: boolean) {
  const s = await assertMember(ctx);
  const { g } = await assertGroupAdmin(ctx, groupId);
  const m = await prisma.buyingGroupMember.findUnique({ where: { groupId_companyId: { groupId, companyId } } });
  if (m?.status !== "REQUESTED") throw new ValidationError("There's no request to answer.");
  if (accept) await activate(groupId, companyId, s);
  else await prisma.buyingGroupMember.update({ where: { id: m.id }, data: { status: "DECLINED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: accept ? "groups.request_accepted" : "groups.request_declined", entityType: "BuyingGroup", entityId: groupId, after: { companyId } });
  await notify("group.join_decided", [{ companyId, link: `/buy/groups/${groupId}` }], { name: g.name, decision: accept ? "ACCEPTED" : "DECLINED" }).catch(() => null);
}

/** Leave a group. The last admin hands over to the longest-standing member; the last member closes it. */
export async function leaveGroup(ctx: Ctx, groupId: string) {
  if (!manager(ctx)) throw new ForbiddenError("Only the owner or a company manager can do this.");
  const { me } = await viewerOf(ctx, groupId);
  if (!me) throw new NotFoundError("Group");
  if (me.status !== "ACTIVE") { await prisma.buyingGroupMember.update({ where: { id: me.id }, data: { status: "DECLINED" } }); return; }
  await prisma.buyingGroupMember.update({ where: { id: me.id }, data: { status: "LEFT", leftAt: new Date(), role: "MEMBER" } });
  const left = await prisma.buyingGroupMember.findMany({ where: { groupId, status: "ACTIVE" }, orderBy: { joinedAt: "asc" } });
  if (!left.length) await prisma.buyingGroup.update({ where: { id: groupId }, data: { status: "CLOSED" } });
  else if (!left.some((m) => m.role === "ADMIN")) await prisma.buyingGroupMember.update({ where: { id: left[0].id }, data: { role: "ADMIN" } });
  await syncPriceGroups(groupId);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.left", entityType: "BuyingGroup", entityId: groupId });
}

export async function removeMember(ctx: Ctx, groupId: string, companyId: string) {
  await assertGroupAdmin(ctx, groupId, false);
  if (companyId === ctx.company.id) throw new ValidationError("Use “Leave group” to leave it yourself.");
  const m = await prisma.buyingGroupMember.findUnique({ where: { groupId_companyId: { groupId, companyId } } });
  if (!m) throw new NotFoundError("Member");
  await prisma.buyingGroupMember.update({ where: { id: m.id }, data: { status: "REMOVED", leftAt: m.status === "ACTIVE" ? new Date() : m.leftAt, role: "MEMBER" } });
  await syncPriceGroups(groupId);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.removed", entityType: "BuyingGroup", entityId: groupId, after: { companyId } });
}

export async function setRole(ctx: Ctx, groupId: string, companyId: string, role: "ADMIN" | "MEMBER") {
  await assertGroupAdmin(ctx, groupId, false);
  const m = await prisma.buyingGroupMember.findUnique({ where: { groupId_companyId: { groupId, companyId } } });
  if (m?.status !== "ACTIVE") throw new NotFoundError("Member");
  if (role === "MEMBER" && (await admins(groupId)).length <= 1 && m.role === "ADMIN") throw new ValidationError("A group needs at least one admin.");
  await prisma.buyingGroupMember.update({ where: { id: m.id }, data: { role } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.role", entityType: "BuyingGroup", entityId: groupId, after: { companyId, role } });
}

/** Members (company ids) of a group during [start, end) — for pooled bonuses. */
export async function membersDuring(groupId: string, start: Date, end: Date) {
  const rows = await prisma.buyingGroupMember.findMany({
    where: { groupId, joinedAt: { not: null, lt: end }, OR: [{ status: "ACTIVE" }, { status: { in: ["LEFT", "REMOVED"] }, leftAt: { gt: start } }] },
    select: { companyId: true },
  });
  return rows.map((r) => r.companyId);
}

// ── group prices (suppliers) ────────────────────────────────────────────────

/** Keep every supplier's customer group for this buying group in step with its active members. */
export async function syncPriceGroups(groupId: string) {
  const [groups, members] = await Promise.all([
    prisma.customerGroup.findMany({ where: { buyingGroupId: groupId }, select: { id: true } }),
    prisma.buyingGroupMember.findMany({ where: { groupId, status: "ACTIVE" }, select: { companyId: true } }),
  ]);
  const ids = members.map((m) => m.companyId);
  for (const cg of groups) {
    await prisma.customerGroupMember.deleteMany({ where: { groupId: cg.id, companyId: { notIn: ids } } });
    if (ids.length) await prisma.customerGroupMember.createMany({ data: ids.map((companyId) => ({ groupId: cg.id, companyId })), skipDuplicates: true });
  }
}

function assertSupplier(ctx: Ctx) {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (!can(ctx, ["vendor.pricing.manage", "vendor.promotions.manage"])) throw new ForbiddenError();
}

/** Approved buying groups a supplier can give prices to, with what it gives them now. */
export async function supplierGroups(ctx: Ctx) {
  assertSupplier(ctx);
  const s = await groupSettings();
  const buyerType = ctx.company.type === "WHOLESALER" ? "CUSTOMER" : "WHOLESALER"; // who buys from this supplier
  const groups = await prisma.buyingGroup.findMany({
    where: { status: "APPROVED", ...(ctx.company.type === "WHOLESALER" ? { countryId: ctx.company.countryId } : {}) },
    include: { country: { select: { code: true, flag: true } }, members: { where: LIVE, select: { company: { select: { type: true } } } } },
    orderBy: { name: "asc" }, take: 500,
  });
  const lists = await prisma.priceList.findMany({ where: { vendorCompanyId: ctx.company.id, isActive: true, targetGroup: { buyingGroupId: { in: groups.map((g) => g.id) } } }, include: { targetGroup: { select: { buyingGroupId: true } }, _count: { select: { items: true } } } });
  return {
    enabled: s.enabled && s.features.groupPrices,
    groups: groups.map((g) => {
      const pl = lists.find((l) => l.targetGroup?.buyingGroupId === g.id);
      return { id: g.id, name: g.name, description: g.description, country: `${g.country.flag ?? ""} ${g.country.code}`, members: g.members.length, buyers: g.members.filter((m) => m.company.type === buyerType).length, priceList: pl ? { id: pl.id, items: pl._count.items, validTo: pl.validTo } : null };
    }),
  };
}

/**
 * A supplier's prices for a buying group: a % off its base prices (every product with a base price), or chosen
 * products at chosen prices. Replaces the previous group price list.
 */
export async function setGroupPrices(ctx: Ctx, groupId: string, input: { pct?: number | null; items?: { offerId: string; price: number }[]; validTo?: string | null }) {
  assertSupplier(ctx);
  const s = await groupSettings();
  if (!s.enabled) throw new ValidationError("Buying groups are switched off.");
  assertFeature(s, "groupPrices");
  const g = await prisma.buyingGroup.findFirst({ where: { id: groupId, status: "APPROVED" } });
  if (!g) throw new NotFoundError("Group");
  let items: { offerId: string; price: number }[];
  if (input.pct != null) {
    const pct = Number(input.pct);
    if (!(pct > 0 && pct <= 50)) throw new ValidationError("The group discount is between 0.1 and 50 %.");
    const base = await prisma.priceListItem.findMany({ where: { minQty: { lte: 1 }, priceList: { vendorCompanyId: ctx.company.id, scope: "BASE", isActive: true }, offer: { status: "ACTIVE" } }, select: { offerId: true, unitPriceNet: true } });
    items = base.map((b) => ({ offerId: b.offerId, price: Math.round(Number(b.unitPriceNet) * (1 - pct / 100) * 10000) / 10000 }));
  } else {
    items = (input.items ?? []).filter((i) => i.price > 0);
    const own = await prisma.vendorOffer.count({ where: { id: { in: items.map((i) => i.offerId) }, vendorCompanyId: ctx.company.id } });
    if (own !== new Set(items.map((i) => i.offerId)).size) throw new ValidationError("Only your own products can have group prices.");
  }
  if (!items.length) throw new ValidationError("No products to price — give a % off your base prices or choose products.");
  const validTo = input.validTo ? new Date(`${input.validTo.slice(0, 10)}T23:59:59Z`) : null;
  if (validTo && validTo <= new Date()) throw new ValidationError("The end date must be in the future.");
  const pl = await prisma.$transaction(async (tx) => {
    const cg = (await tx.customerGroup.findFirst({ where: { ownerCompanyId: ctx.company.id, buyingGroupId: groupId } }))
      ?? (await tx.customerGroup.create({ data: { ownerCompanyId: ctx.company.id, buyingGroupId: groupId, name: `Buying group: ${g.name}`.slice(0, 120), description: "Kept in step with the buying group's members by FIRINGI." } }));
    await tx.priceList.updateMany({ where: { vendorCompanyId: ctx.company.id, targetGroupId: cg.id, isActive: true }, data: { isActive: false } });
    return tx.priceList.create({
      data: {
        vendorCompanyId: ctx.company.id, name: `Buying group: ${g.name}`.slice(0, 120), scope: "CUSTOMER_GROUP", targetGroupId: cg.id, countryId: ctx.company.countryId, currencyCode: "EUR", priority: 5, validTo,
        items: { create: [...new Map(items.map((i) => [i.offerId, i])).values()].map((i) => ({ offerId: i.offerId, minQty: 1, unitPriceNet: i.price.toFixed(4) })) },
      },
    });
  });
  await syncPriceGroups(groupId);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.prices_set", entityType: "BuyingGroup", entityId: groupId, after: { priceListId: pl.id, items: items.length, pct: input.pct ?? null } });
  for (const id of await admins(groupId)) await notify("group.prices", [{ companyId: id, link: `/buy/groups/${groupId}` }], { name: g.name, supplier: nameOf(ctx.company) }).catch(() => null);
  return pl;
}

export async function stopGroupPrices(ctx: Ctx, groupId: string) {
  assertSupplier(ctx);
  const n = await prisma.priceList.updateMany({ where: { vendorCompanyId: ctx.company.id, isActive: true, targetGroup: { buyingGroupId: groupId } }, data: { isActive: false } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.prices_stopped", entityType: "BuyingGroup", entityId: groupId, after: { lists: n.count } });
}

/** The supplier's products for the group price form. */
export async function supplierOffers(ctx: Ctx) {
  assertSupplier(ctx);
  const rows = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" },
    select: { id: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } }, prices: { where: { minQty: { lte: 1 }, priceList: { scope: "BASE", isActive: true } }, select: { unitPriceNet: true }, take: 1 } },
    take: 2000,
  });
  return rows.map((o) => ({ id: o.id, label: `${pick(o.packaging.variant.product.name)} — ${pick(o.packaging.name)}`, sku: o.packaging.variant.sku, base: o.prices[0] ? Number(o.prices[0].unitPriceNet) : null })).sort((a, b) => a.label.localeCompare(b.label));
}

// ── group order rounds ──────────────────────────────────────────────────────

export async function openRound(ctx: Ctx, groupId: string, input: { sellerCompanyId: string; title: string; note?: string | null; closesAt: string; deliveryDate: string }) {
  const s = await assertMember(ctx);
  assertFeature(s, "groupOrders");
  const { g } = await assertGroupAdmin(ctx, groupId);
  const seller = await prisma.company.findFirst({ where: { id: input.sellerCompanyId, status: "APPROVED", type: { in: ["DISTRIBUTOR", "WHOLESALER"] } }, select: { id: true, legalName: true, tradeName: true } });
  if (!seller) throw new ValidationError("Choose the supplier.");
  const title = input.title?.trim();
  if (!title || title.length > 80) throw new ValidationError("Give the group order a name (up to 80 characters).");
  const closesAt = new Date(input.closesAt), deliveryDate = new Date(`${input.deliveryDate.slice(0, 10)}T00:00:00Z`);
  if (!(closesAt.getTime() > Date.now())) throw new ValidationError("The closing time must be in the future.");
  if (closesAt.getTime() > Date.now() + s.roundMaxDays * DAY) throw new ValidationError(`A group order stays open at most ${s.roundMaxDays} days.`);
  if (deliveryDate.getTime() < new Date(closesAt.toISOString().slice(0, 10) + "T00:00:00Z").getTime()) throw new ValidationError("Delivery can't be before the order closes.");
  const r = await prisma.groupOrderRound.create({ data: { groupId, sellerCompanyId: seller.id, title, note: input.note?.trim() || null, closesAt, deliveryDate, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.round_opened", entityType: "GroupOrderRound", entityId: r.id, after: { groupId, seller: seller.id } });
  const members = await prisma.buyingGroupMember.findMany({ where: { groupId, status: "ACTIVE", companyId: { not: ctx.company.id } }, select: { companyId: true } });
  for (const m of members) await notify("group.round_opened", [{ companyId: m.companyId, link: `/buy/groups/${groupId}/rounds/${r.id}` }], { name: g.name, title, supplier: nameOf(seller), date: closesAt.toISOString().slice(0, 16).replace("T", " ") }).catch(() => null);
  return r;
}

/** Customers buy from wholesalers, wholesalers from distributors. */
async function buysFrom(buyerType: string, sellerId: string) {
  const seller = await prisma.company.findUnique({ where: { id: sellerId }, select: { type: true } });
  return !!seller && ((buyerType === "CUSTOMER" && seller.type === "WHOLESALER") || (buyerType === "WHOLESALER" && seller.type === "DISTRIBUTOR"));
}

async function roundFor(ctx: Ctx, roundId: string) {
  const r = await prisma.groupOrderRound.findUnique({ where: { id: roundId } });
  if (!r) throw new NotFoundError("Group order");
  const v = await viewerOf(ctx, r.groupId);
  if (!v.firingi && v.me?.status !== "ACTIVE") throw new NotFoundError("Group order");
  return { r, ...v };
}

/** A member adds / changes / removes (qty 0) a line while the round is open. */
export async function setRoundLine(ctx: Ctx, roundId: string, input: { offerId: string; qty: number; addressId?: string | null }) {
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const { r } = await roundFor(ctx, roundId);
  if (r.status !== "OPEN" || r.closesAt <= new Date()) throw new ValidationError("This group order is closed.");
  const qty = Math.floor(Number(input.qty));
  if (!(qty >= 0 && qty <= 100000)) throw new ValidationError("Check the quantity.");
  if (!(await buysFrom(ctx.company.type, r.sellerCompanyId))) throw new ValidationError("This supplier doesn't sell to your type of business.");
  const offer = await prisma.vendorOffer.findFirst({ where: { id: input.offerId, vendorCompanyId: r.sellerCompanyId, status: "ACTIVE" } });
  if (!offer) throw new ValidationError("That product isn't from this group order's supplier.");
  if (input.addressId && !(await prisma.address.findFirst({ where: { id: input.addressId, companyId: ctx.company.id, kind: "DELIVERY", isActive: true } }))) throw new ValidationError("Choose one of your delivery addresses.");
  const key = { roundId_companyId_offerId: { roundId, companyId: ctx.company.id, offerId: offer.id } };
  if (qty === 0) { await prisma.groupOrderLine.deleteMany({ where: { roundId, companyId: ctx.company.id, offerId: offer.id } }); return null; }
  return prisma.groupOrderLine.upsert({ where: key, create: { roundId, companyId: ctx.company.id, userId: ctx.user.id, offerId: offer.id, qty, addressId: input.addressId ?? null }, update: { qty, userId: ctx.user.id, ...(input.addressId !== undefined ? { addressId: input.addressId } : {}) } });
}

export async function cancelRound(ctx: Ctx, roundId: string) {
  const r = await prisma.groupOrderRound.findUnique({ where: { id: roundId } });
  if (!r) throw new NotFoundError("Group order");
  await assertGroupAdmin(ctx, r.groupId, false);
  if (r.status !== "OPEN") throw new ValidationError("This group order is no longer open.");
  await prisma.groupOrderRound.update({ where: { id: roundId }, data: { status: "CANCELLED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "groups.round_cancelled", entityType: "GroupOrderRound", entityId: roundId });
}

/** Place every member's order of a round (at its close, or now by a group admin). */
export async function placeRound(roundId: string, by?: Ctx) {
  if (by) {
    const r0 = await prisma.groupOrderRound.findUnique({ where: { id: roundId } });
    if (!r0) throw new NotFoundError("Group order");
    await assertGroupAdmin(by, r0.groupId);
  }
  const claimed = await prisma.groupOrderRound.updateMany({ where: { id: roundId, status: "OPEN" }, data: { status: "PLACED", placedAt: new Date() } });
  if (!claimed.count) return { placed: 0, failed: 0 };
  const r = await prisma.groupOrderRound.findUniqueOrThrow({ where: { id: roundId }, include: { lines: true, group: true } });
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: r.sellerCompanyId }, select: { legalName: true, tradeName: true } });
  const byCompany = new Map<string, typeof r.lines>();
  for (const l of r.lines) byCompany.set(l.companyId, [...(byCompany.get(l.companyId) ?? []), l]);
  let placed = 0, failed = 0;
  const { placeOrder } = await import("@/server/services/orders");
  for (const [companyId, lines] of byCompany) {
    const stillMember = await prisma.buyingGroupMember.count({ where: { groupId: r.groupId, companyId, status: "ACTIVE" } });
    let error: string | null = null, orderId: string | null = null;
    try {
      if (!stillMember) throw new Error("No longer a member of the group.");
      const actor = await loadContext(lines[0].userId, "group-round", companyId);
      if (!actor || actor.company.id !== companyId) throw new Error("The person who added these lines can't order for the business any more.");
      const addressId = lines.find((l) => l.addressId)?.addressId
        ?? (await prisma.address.findFirst({ where: { companyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } }))?.id;
      if (!addressId) throw new Error("No delivery address.");
      const res = await placeOrder(actor, { deliveryAddressId: addressId, items: lines.map((l) => ({ offerId: l.offerId, qty: l.qty })), requestedDeliveryDate: r.deliveryDate, notes: `Group order: ${r.title} (${r.group.name})`, approved: true, groupRoundId: r.id });
      orderId = res.id; placed++;
    } catch (e) { error = (e as Error).message.slice(0, 300); failed++; }
    await prisma.groupOrderLine.updateMany({ where: { roundId, companyId }, data: { orderId, error } });
    await notify(error ? "group.round_failed" : "group.round_placed", [{ companyId, link: `/buy/groups/${r.groupId}/rounds/${r.id}` }], { name: r.group.name, title: r.title, reason: error ?? "" }).catch(() => null);
  }
  if (placed) await notify("group.round_supplier", [{ companyId: r.sellerCompanyId, link: "/vendor/orders" }], { name: r.group.name, title: r.title, orders: placed, date: r.deliveryDate.toISOString().slice(0, 10) }).catch(() => null);
  void seller;
  return { placed, failed };
}

/** Job: place rounds that have closed. */
export async function runGroupsJob(now = new Date()) {
  const due = await prisma.groupOrderRound.findMany({ where: { status: "OPEN", closesAt: { lte: now } }, select: { id: true } });
  let placed = 0, failed = 0;
  for (const r of due) { const x = await placeRound(r.id); placed += x.placed; failed += x.failed; }
  return { rounds: due.length, placed, failed };
}

// ── reading ─────────────────────────────────────────────────────────────────

export async function myGroups(ctx: Ctx) {
  const s = await groupSettings();
  const access = await groupAccess(ctx.company, s);
  const rows = access.member ? await prisma.buyingGroupMember.findMany({
    where: { companyId: ctx.company.id, status: { in: ["ACTIVE", "INVITED", "REQUESTED"] }, group: { status: { not: "CLOSED" } } },
    include: { group: { include: { _count: { select: { members: { where: LIVE } } } } } }, orderBy: { createdAt: "desc" },
  }) : [];
  return {
    settings: s, access,
    groups: rows.map((m) => ({ id: m.group.id, name: m.group.name, description: m.group.description, status: m.group.status, reviewNote: m.group.reviewNote, members: m.group._count.members, myStatus: m.status, myRole: m.role })),
  };
}

export async function groupDetail(ctx: Ctx, groupId: string) {
  const v = await viewerOf(ctx, groupId);
  const s = await groupSettings();
  const now = new Date();
  const [members, rounds, prices, bonuses] = await Promise.all([
    prisma.buyingGroupMember.findMany({ where: { groupId }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } }, orderBy: [{ status: "asc" }, { joinedAt: "asc" }] }),
    prisma.groupOrderRound.findMany({ where: { groupId }, orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { lines: true } } } }),
    prisma.priceList.findMany({ where: { isActive: true, targetGroup: { buyingGroupId: groupId }, OR: [{ validTo: null }, { validTo: { gt: now } }] }, include: { vendor: { select: { legalName: true, tradeName: true } }, _count: { select: { items: true } } } }),
    prisma.tradeBonus.findMany({ where: { buyingGroupId: groupId, status: "APPROVED", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] }, include: { seller: { select: { legalName: true, tradeName: true } } } }),
  ]);
  const sellers = await prisma.company.findMany({ where: { id: { in: rounds.map((r) => r.sellerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const seeAll = v.admin || v.firingi;
  return {
    group: v.g, settings: s, me: v.me, admin: v.admin, firingi: v.firingi,
    members: members.filter((m) => seeAll ? true : m.status === "ACTIVE").map((m) => ({ companyId: m.companyId, name: nameOf(m.company), type: m.company.type, role: m.role, status: m.status, joinedAt: m.joinedAt, message: seeAll ? m.message : null, me: m.companyId === ctx.company.id })),
    rounds: rounds.map((r) => ({ ...r, supplier: nameOf(sellers.find((x) => x.id === r.sellerCompanyId) ?? { legalName: "?", tradeName: null }), lines: r._count.lines })),
    prices: prices.map((p) => ({ id: p.id, supplier: nameOf(p.vendor), items: p._count.items, validTo: p.validTo })),
    bonuses: bonuses.map((b) => ({ id: b.id, name: b.name, kind: b.kind, period: b.period, supplier: nameOf(b.seller) })),
  };
}

/** Suppliers a group admin can open a round with (those the members can buy from). */
export async function roundSuppliers(ctx: Ctx, groupId: string) {
  await assertGroupAdmin(ctx, groupId, false);
  const g = await prisma.buyingGroup.findUniqueOrThrow({ where: { id: groupId } });
  const rows = await prisma.company.findMany({ where: { status: "APPROVED", OR: [{ type: "WHOLESALER", countryId: g.countryId }, { type: "DISTRIBUTOR" }] }, select: { id: true, legalName: true, tradeName: true, type: true }, orderBy: { legalName: "asc" }, take: 500 });
  return rows.map((c) => ({ id: c.id, name: nameOf(c), type: c.type }));
}

export async function roundDetail(ctx: Ctx, roundId: string) {
  const { r, admin, firingi, g } = await roundFor(ctx, roundId);
  const lines = await prisma.groupOrderLine.findMany({ where: { roundId } });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.offerId))] } }, select: { id: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } });
  const label = new Map(offers.map((o) => [o.id, `${pick(o.packaging.variant.product.name)} — ${pick(o.packaging.name)} (${o.packaging.variant.sku})`]));
  const cos = await prisma.company.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.companyId))] } }, select: { id: true, legalName: true, tradeName: true } });
  const coName = new Map(cos.map((c) => [c.id, nameOf(c)]));
  const totals = new Map<string, { offerId: string; label: string; qty: number; members: number }>();
  for (const l of lines) { const t = totals.get(l.offerId) ?? { offerId: l.offerId, label: label.get(l.offerId) ?? "?", qty: 0, members: 0 }; t.qty += l.qty; t.members++; totals.set(l.offerId, t); }
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: r.sellerCompanyId }, select: { legalName: true, tradeName: true } });
  const addresses = ctx.company.type === "ADMIN" ? [] : await prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, select: { id: true, label: true, line1: true, isDefault: true }, orderBy: { isDefault: "desc" } });
  return {
    round: r, group: g, supplier: nameOf(seller), admin, firingi, addresses,
    open: r.status === "OPEN" && r.closesAt > new Date(), canBuy: ctx.company.type !== "ADMIN" && (await buysFrom(ctx.company.type, r.sellerCompanyId)),
    mine: lines.filter((l) => l.companyId === ctx.company.id).map((l) => ({ ...l, label: label.get(l.offerId) ?? "?" })),
    totals: [...totals.values()].sort((a, b) => b.qty - a.qty),
    members: admin || firingi ? [...new Set(lines.map((l) => l.companyId))].map((id) => ({ companyId: id, name: coName.get(id) ?? "?", lines: lines.filter((l) => l.companyId === id).length, units: lines.filter((l) => l.companyId === id).reduce((a, l) => a + l.qty, 0), orderId: lines.find((l) => l.companyId === id)?.orderId ?? null, error: lines.find((l) => l.companyId === id)?.error ?? null })) : [],
    memberCount: new Set(lines.map((l) => l.companyId)).size,
  };
}

/** The round supplier's products a member can add (searched by name / SKU). */
export async function roundOffers(ctx: Ctx, roundId: string, q: string) {
  const { r } = await roundFor(ctx, roundId);
  const term = q.trim();
  const rows = await prisma.vendorOffer.findMany({
    where: {
      vendorCompanyId: r.sellerCompanyId, status: "ACTIVE",
      ...(term ? { OR: [{ packaging: { variant: { sku: { contains: term, mode: "insensitive" } } } }, { packaging: { variant: { product: { searchText: { contains: term.toLowerCase() } } } } }] } : {}),
    },
    select: { id: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } }, take: 30,
  });
  return rows.map((o) => ({ id: o.id, label: `${pick(o.packaging.variant.product.name)} — ${pick(o.packaging.name)} (${o.packaging.variant.sku})` }));
}

type Period = "MONTH" | "QUARTER" | "YEAR";

/** The group's purchases this period (FIRINGI's invoices net of credit notes), by member and supplier; bonuses earned together. */
export async function groupReport(ctx: Ctx, groupId: string, period: Period = "QUARTER") {
  const v = await viewerOf(ctx, groupId);
  if (!v.firingi && v.me?.status !== "ACTIVE") throw new NotFoundError("Group");
  const s = await groupSettings();
  assertFeature(s, "reports");
  const { periodOf } = await import("@/lib/rebates");
  const p = periodOf(new Date(), period);
  const members = await membersDuring(groupId, p.start, p.end);
  const rows = members.length ? await prisma.$queryRaw<{ companyId: string; sellerId: string; net: Prisma.Decimal; orders: bigint }[]>`
    SELECT i."recipientCompanyId" AS "companyId", o."sellerCompanyId" AS "sellerId",
      SUM(CASE WHEN i."docType" = 'CREDIT_NOTE' THEN -i."netTotal" ELSE i."netTotal" END) AS net,
      COUNT(DISTINCT CASE WHEN i."docType" <> 'CREDIT_NOTE' THEN i."orderId" END) AS orders
    FROM "Invoice" i JOIN "Order" o ON o.id = i."orderId"
    WHERE i."recipientCompanyId" = ANY(${members}) AND i.status <> 'DRAFT'
      AND COALESCE(i."issuedAt", i."createdAt") >= ${p.start} AND COALESCE(i."issuedAt", i."createdAt") < ${p.end}
    GROUP BY 1, 2` : [];
  const ids = [...new Set([...members, ...rows.map((r) => r.sellerId)])];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } });
  const nm = new Map(cos.map((c) => [c.id, nameOf(c)]));
  const byMember = new Map<string, { net: number; orders: number }>();
  const bySupplier = new Map<string, number>();
  for (const r of rows) {
    const m = byMember.get(r.companyId) ?? { net: 0, orders: 0 };
    m.net += Number(r.net); m.orders += Number(r.orders); byMember.set(r.companyId, m);
    bySupplier.set(r.sellerId, (bySupplier.get(r.sellerId) ?? 0) + Number(r.net));
  }
  const total = [...byMember.values()].reduce((a, m) => a + m.net, 0);
  const bonus = await prisma.tradeBonusSettlement.aggregate({ where: { status: "SETTLED", bonus: { buyingGroupId: groupId }, companyId: { in: members }, periodStart: { gte: new Date(p.start.getTime() - 366 * DAY) } }, _sum: { value: true, freeUnits: true } });
  const myBonus = await prisma.tradeBonusSettlement.aggregate({ where: { status: "SETTLED", bonus: { buyingGroupId: groupId }, companyId: ctx.company.id }, _sum: { value: true, freeUnits: true } });
  const seeAll = v.admin || v.firingi;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const me = byMember.get(ctx.company.id) ?? { net: 0, orders: 0 };
  return {
    period: p.key, total: round2(total), members: members.length,
    me: { net: round2(me.net), orders: me.orders, share: total > 0 ? Math.round((me.net / total) * 1000) / 10 : 0, bonus: Number(myBonus._sum.value ?? 0), free: myBonus._sum.freeUnits ?? 0 },
    byMember: seeAll ? members.map((id) => ({ companyId: id, name: nm.get(id) ?? "?", net: round2(byMember.get(id)?.net ?? 0), orders: byMember.get(id)?.orders ?? 0, share: total > 0 ? Math.round(((byMember.get(id)?.net ?? 0) / total) * 1000) / 10 : 0 })).sort((a, b) => b.net - a.net) : [],
    bySupplier: [...bySupplier.entries()].map(([id, net]) => ({ name: nm.get(id) ?? "?", net: round2(net) })).sort((a, b) => b.net - a.net),
    bonuses: { value: Number(bonus._sum.value ?? 0), free: bonus._sum.freeUnits ?? 0 },
  };
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminGroups(ctx: Ctx) {
  staff(ctx);
  const rows = await prisma.buyingGroup.findMany({ include: { country: { select: { code: true, flag: true } }, _count: { select: { members: { where: LIVE }, rounds: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500 });
  const creators = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.createdByCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((g) => ({ ...g, country: `${g.country.flag ?? ""} ${g.country.code}`, members: g._count.members, rounds: g._count.rounds, creator: nameOf(creators.find((c) => c.id === g.createdByCompanyId) ?? { legalName: "?", tradeName: null }) }));
}

export async function groupsOverview(ctx: Ctx) {
  staff(ctx);
  const [pending, live, members, openRounds, priced] = await Promise.all([
    prisma.buyingGroup.count({ where: { status: "PENDING" } }),
    prisma.buyingGroup.count({ where: { status: "APPROVED" } }),
    prisma.buyingGroupMember.count({ where: { status: "ACTIVE", group: { status: "APPROVED" } } }),
    prisma.groupOrderRound.count({ where: { status: "OPEN" } }),
    prisma.priceList.count({ where: { isActive: true, targetGroup: { buyingGroupId: { not: null } } } }),
  ]);
  return { pending, live, members, openRounds, priced };
}

export async function companySwitches(ctx: Ctx) {
  staff(ctx);
  const feats = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return feats.map((f) => ({ companyId: f.companyId, name: nameOf(f.company), type: f.company.type, state: f.enabled ? "ON" as const : "OFF" as const }));
}

export async function findBusiness(ctx: Ctx, q: string) {
  staff(ctx);
  const t = q.trim();
  if (t.length < 2) return [];
  const { adminCompanyWhere, countryLabel } = await import("@/server/services/admin-search");
  const rows = await prisma.company.findMany({ where: { AND: [await adminCompanyWhere(ctx), { type: { in: ["CUSTOMER", "WHOLESALER"] }, OR: [{ legalName: { contains: t, mode: "insensitive" } }, { tradeName: { contains: t, mode: "insensitive" } }, { taxId: { contains: t } }] }] }, select: { id: true, legalName: true, tradeName: true, type: true }, take: 15 });
  return (await countryLabel(rows.map((c) => ({ id: c.id, name: nameOf(c) })))).map((r, k) => ({ ...r, type: rows[k].type }));
}

