"use server";
/** Multi-site buyers (Phase 27): shops, staff, budgets, PO setting; FIRINGI's company feature switches. */
import { z } from "zod";
import { defineAction } from "./_action";
import { addShopAddress, deleteBranch, saveBranch, setAddressBranch, setBranchActive, setBranchMember, setPoRequired } from "@/server/multisite/branches";
import { budgetPreview, deleteBudget, saveBudget } from "@/server/multisite/budgets";
import { setCompanyFeature } from "@/server/accounting/features";

const id = z.string().min(1).max(40);
const opt = (n: number) => z.string().max(n).nullable().optional();
const MANAGE = "buyer.branches.manage" as const;
const address = z.object({ line1: z.string().min(1).max(200), line2: opt(200), postalCode: z.string().min(1).max(20), countryCode: z.string().length(2), cityId: opt(40), cityName: z.string().min(1).max(120), contactName: opt(120), phone: opt(40), label: opt(80) });
const branch = z.object({ name: z.string().min(1).max(80), code: opt(20), category: opt(40), costCentre: opt(40), phone: opt(40), managerMembershipId: opt(40), address: address.nullable().optional() });

export const saveBranchAction = defineAction({ permission: MANAGE, schema: branch.extend({ id: id.nullable().optional() }), handler: async (ctx, i) => saveBranch(ctx, i.id ?? null, i) });
export const addShopAddressAction = defineAction({ permission: MANAGE, schema: z.object({ branchId: id, address }), handler: async (ctx, i) => addShopAddress(ctx, i.branchId, i.address) });
export const setBranchActiveAction = defineAction({ permission: MANAGE, schema: z.object({ id, active: z.boolean() }), handler: async (ctx, i) => { await setBranchActive(ctx, i.id, i.active); return true; } });
export const deleteBranchAction = defineAction({ permission: MANAGE, schema: z.object({ id }), handler: async (ctx, i) => { await deleteBranch(ctx, i.id); return true; } });
export const setAddressBranchAction = defineAction({ permission: MANAGE, schema: z.object({ addressId: id, branchId: id.nullable() }), handler: async (ctx, i) => { await setAddressBranch(ctx, i.addressId, i.branchId); return true; } });
export const setBranchMemberAction = defineAction({ permission: MANAGE, schema: z.object({ branchId: id, membershipId: id, on: z.boolean() }), handler: async (ctx, i) => { await setBranchMember(ctx, i.branchId, i.membershipId, i.on); return true; } });
export const setPoRequiredAction = defineAction({ permission: MANAGE, schema: z.object({ required: z.boolean() }), handler: async (ctx, i) => { await setPoRequired(ctx, i.required); return true; } });

export const saveBudgetAction = defineAction({
  permission: MANAGE,
  schema: z.object({ id: id.nullable().optional(), name: z.string().min(1).max(80), branchId: id.nullable(), period: z.enum(["WEEKLY", "MONTHLY"]), amount: z.number().positive().max(100_000_000), categoryIds: z.array(id).max(50), action: z.enum(["APPROVAL", "BLOCK", "WARN"]), isActive: z.boolean().optional() }),
  handler: async (ctx, i) => saveBudget(ctx, i.id ?? null, i),
});
export const deleteBudgetAction = defineAction({ permission: MANAGE, schema: z.object({ id }), handler: async (ctx, i) => { await deleteBudget(ctx, i.id); return true; } });
export const budgetPreviewAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ addressId: id }), handler: async (ctx, i) => budgetPreview(ctx, i.addressId) });

export const setCompanyFeatureAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ companyId: id, key: z.enum(["ACCOUNTING", "ASSISTANT", "ASSISTANT_PHOTOS", "LOYALTY", "ADS", "CHAT", "CHAT_MASK", "WHATSAPP_ORDERING"]), enabled: z.boolean() }), handler: async (ctx, i) => { await setCompanyFeature(ctx, i.companyId, i.key, i.enabled); return true; } });
