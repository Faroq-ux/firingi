"use server";
/** Buying group actions (Phase 49). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as G from "@/server/buying-groups/service";
import { GROUP_FEATURES } from "@/lib/buying-groups";

const id = z.string().min(1).max(64);
const done = <T>(v: T) => { revalidatePath("/buy/groups", "layout"); revalidatePath("/vendor/products/buying-groups"); revalidatePath("/admin/customers/buying-groups", "layout"); return v; };
const ADMIN = ["admin.customers.manage", "admin.settings.manage"] as const;

// businesses
export const createGroupAction = defineAction({ permission: null, schema: z.object({ name: z.string().max(80), description: z.string().max(500).nullable().optional(), open: z.boolean().optional() }), handler: async (ctx, i) => done({ id: (await G.createGroup(ctx, i)).id }) });
export const updateGroupAction = defineAction({ permission: null, schema: z.object({ id, name: z.string().max(80), description: z.string().max(500).nullable().optional(), open: z.boolean() }), handler: async (ctx, i) => { await G.updateGroup(ctx, i.id, i); return done(true); } });
export const inviteMemberAction = defineAction({ permission: null, schema: z.object({ groupId: id, taxId: z.string().max(40), message: z.string().max(300).nullable().optional() }), handler: async (ctx, i) => done({ company: (await G.inviteMember(ctx, i.groupId, i.taxId, i.message)).company }) });
export const respondInviteAction = defineAction({ permission: null, schema: z.object({ groupId: id, accept: z.boolean() }), handler: async (ctx, i) => { await G.respondInvite(ctx, i.groupId, i.accept); return done(true); } });
export const requestJoinAction = defineAction({ permission: null, schema: z.object({ groupId: id, message: z.string().max(300).nullable().optional() }), handler: async (ctx, i) => { await G.requestJoin(ctx, i.groupId, i.message); return done(true); } });
export const decideRequestAction = defineAction({ permission: null, schema: z.object({ groupId: id, companyId: id, accept: z.boolean() }), handler: async (ctx, i) => { await G.decideRequest(ctx, i.groupId, i.companyId, i.accept); return done(true); } });
export const leaveGroupAction = defineAction({ permission: null, schema: z.object({ groupId: id }), handler: async (ctx, i) => { await G.leaveGroup(ctx, i.groupId); return done(true); } });
export const removeMemberAction = defineAction({ permission: null, schema: z.object({ groupId: id, companyId: id }), handler: async (ctx, i) => { await G.removeMember(ctx, i.groupId, i.companyId); return done(true); } });
export const setRoleAction = defineAction({ permission: null, schema: z.object({ groupId: id, companyId: id, role: z.enum(["ADMIN", "MEMBER"]) }), handler: async (ctx, i) => { await G.setRole(ctx, i.groupId, i.companyId, i.role); return done(true); } });
export const closeGroupAction = defineAction({ permission: null, schema: z.object({ groupId: id }), handler: async (ctx, i) => { await G.closeGroup(ctx, i.groupId); return done(true); } });
export const openRoundAction = defineAction({
  permission: null, schema: z.object({ groupId: id, sellerCompanyId: id, title: z.string().max(80), note: z.string().max(500).nullable().optional(), closesAt: z.string().max(40), deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/) }),
  handler: async (ctx, i) => done({ id: (await G.openRound(ctx, i.groupId, i)).id }),
});
export const setRoundLineAction = defineAction({ permission: null, schema: z.object({ roundId: id, offerId: id, qty: z.number().int().min(0).max(100000), addressId: id.nullable().optional() }), handler: async (ctx, i) => { await G.setRoundLine(ctx, i.roundId, i); return done(true); } });
export const roundOffersAction = defineAction({ permission: null, schema: z.object({ roundId: id, q: z.string().max(80) }), handler: async (ctx, i) => G.roundOffers(ctx, i.roundId, i.q) });
export const cancelRoundAction = defineAction({ permission: null, schema: z.object({ roundId: id }), handler: async (ctx, i) => { await G.cancelRound(ctx, i.roundId); return done(true); } });
export const placeRoundAction = defineAction({ permission: null, schema: z.object({ roundId: id }), handler: async (ctx, i) => done(await G.placeRound(i.roundId, ctx)) });

// suppliers
export const setGroupPricesAction = defineAction({
  permission: ["vendor.pricing.manage", "vendor.promotions.manage"],
  schema: z.object({ groupId: id, pct: z.number().min(0).max(100).nullable().optional(), items: z.array(z.object({ offerId: id, price: z.number().min(0).max(10_000_000) })).max(3000).optional(), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional() }),
  handler: async (ctx, i) => { await G.setGroupPrices(ctx, i.groupId, i); return done(true); },
});
export const stopGroupPricesAction = defineAction({ permission: ["vendor.pricing.manage", "vendor.promotions.manage"], schema: z.object({ groupId: id }), handler: async (ctx, i) => { await G.stopGroupPrices(ctx, i.groupId); return done(true); } });

// FIRINGI
export const reviewGroupAction = defineAction({ permission: [...ADMIN], schema: z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable() }), handler: async (ctx, i) => { await G.reviewGroup(ctx, i.id, i.approve, i.note); return done(true); } });
export const setGroupSwitchAction = defineAction({ permission: [...ADMIN], schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => { await G.setCompanySwitch(ctx, i.companyId, i.state); return done(true); } });
export const findBusinessAction = defineAction({ permission: [...ADMIN], schema: z.object({ q: z.string().max(80) }), handler: async (ctx, i) => G.findBusiness(ctx, i.q) });
const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
export const saveGroupSettingsAction = defineAction({
  permission: [...ADMIN],
  schema: z.object({
    enabled: z.boolean(), members: flags(["CUSTOMER", "WHOLESALER"] as const), creators: flags(["CUSTOMER", "WHOLESALER"] as const), approval: z.enum(["ALWAYS", "AUTO"]),
    features: flags(GROUP_FEATURES), joinRequests: z.boolean(), multipleGroups: z.boolean(), maxMembers: z.number(), roundMaxDays: z.number(),
  }),
  handler: async (ctx, i) => done(await G.saveGroupSettings(ctx, i)),
});
