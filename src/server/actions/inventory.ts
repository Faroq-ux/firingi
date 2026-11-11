"use server";
/** Inventory & warehouses (Phase 24): supplier actions + FIRINGI's expiry switches. */
import { z } from "zod";
import { defineAction } from "./_action";
import { receiveStock, setOpeningCost, setReorder, writeOff } from "@/server/inventory/service";
import { cancelPurchaseOrder, createPurchaseOrder, draftFromSuggestions, receivePurchaseOrder, saveSupplier, sendPurchaseOrder, updatePurchaseOrder } from "@/server/inventory/purchasing";
import { addFoundLine, approveCount, cancelCount, cancelTransfer, createTransfer, receiveTransfer, recordCount, reopenCount, sendTransfer, startCount, submitCount } from "@/server/inventory/warehouse";
import { acceptMarkdown, cancelFeatureRequest, decideFeatureRequest, requestFeature, resetSupplierFeatures, setDefaults, setSupplierFeature } from "@/server/inventory/expiry";

const id = z.string().min(1).max(40);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const date = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
const qty = z.number().int().min(0).max(10_000_000);
const money = z.number().min(0).max(10_000_000);
const feature = z.enum(["FEFO", "EXPIRY_ALERTS", "MARKDOWN", "SHOW_EXPIRY"]);
const MANAGE = "vendor.inventory.manage" as const;
const BUY = "vendor.purchasing.manage" as const;

// ── stock ──
export const receiveStockAction = defineAction({
  permission: MANAGE,
  schema: z.object({ offerId: id, addressId: id, qty: z.number().int().min(1).max(10_000_000), unitCost: money.nullable().optional(), lotCode: z.string().max(60).nullable().optional(), expiresOn: isoDate.nullable().optional(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await receiveStock(ctx, { ...i, expiresOn: date(i.expiresOn) }); return true; },
});
export const writeOffAction = defineAction({
  permission: MANAGE, schema: z.object({ batchId: id, qty: z.number().int().min(1).nullable().optional(), reason: z.string().min(1).max(300) }),
  handler: async (ctx, i) => (await writeOff(ctx, i)).qty,
});
export const setReorderAction = defineAction({
  permission: MANAGE, schema: z.object({ offerId: id, addressId: id, reorderPoint: qty.nullable(), reorderQty: z.number().int().min(1).max(10_000_000).nullable() }),
  handler: async (ctx, i) => { await setReorder(ctx, i); return true; },
});
export const setOpeningCostAction = defineAction({
  permission: MANAGE, schema: z.object({ offerId: id, addressId: id, unitCost: money }),
  handler: async (ctx, i) => { await setOpeningCost(ctx, i); return true; },
});

// ── purchasing ──
const supplierSchema = z.object({
  id: id.nullable().optional(), name: z.string().min(1).max(120), vatNumber: z.string().max(30).nullable().optional(), email: z.string().max(160).nullable().optional(),
  phone: z.string().max(40).nullable().optional(), address: z.string().max(300).nullable().optional(), leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(), isActive: z.boolean().optional(),
});
export const saveSupplierAction = defineAction({ permission: BUY, schema: supplierSchema, handler: async (ctx, i) => (await saveSupplier(ctx, i)).id });

const poSchema = z.object({
  supplierId: id.nullable().optional(), sellerCompanyId: id.nullable().optional(), addressId: id, expectedOn: isoDate.nullable().optional(), notes: z.string().max(1000).nullable().optional(),
  lines: z.array(z.object({ offerId: id, qty: z.number().int().min(1).max(1_000_000), unitCost: money.nullable().optional(), sourceOfferId: id.nullable().optional() })).min(1).max(200),
});
export const createPurchaseOrderAction = defineAction({
  permission: BUY, schema: poSchema,
  handler: async (ctx, i) => (await createPurchaseOrder(ctx, { ...i, expectedOn: date(i.expectedOn) })).id,
});
export const updatePurchaseOrderAction = defineAction({
  permission: BUY, schema: poSchema.extend({ id }),
  handler: async (ctx, i) => { await updatePurchaseOrder(ctx, i.id, { ...i, expectedOn: date(i.expectedOn) }); return i.id; },
});
export const sendPurchaseOrderAction = defineAction({
  permission: BUY, schema: z.object({ id, deliveryAddressId: id.nullable().optional(), email: z.boolean().optional() }),
  handler: (ctx, i) => sendPurchaseOrder(ctx, i.id, i),
});
export const cancelPurchaseOrderAction = defineAction({
  permission: BUY, schema: z.object({ id, reason: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await cancelPurchaseOrder(ctx, i.id, i.reason); return true; },
});
export const receivePurchaseOrderAction = defineAction({
  permission: [BUY, MANAGE],
  schema: z.object({ id, note: z.string().max(300).nullable().optional(), lines: z.array(z.object({ lineId: id, qty, lotCode: z.string().max(60).nullable().optional(), expiresOn: isoDate.nullable().optional(), unitCost: money.nullable().optional() })).min(1).max(200) }),
  handler: (ctx, i) => receivePurchaseOrder(ctx, i.id, { note: i.note, lines: i.lines.map((l) => ({ ...l, expiresOn: date(l.expiresOn) })) }),
});
export const draftFromSuggestionsAction = defineAction({
  permission: BUY,
  schema: z.object({ picks: z.array(z.object({ offerId: id, addressId: id, qty: z.number().int().min(1).max(1_000_000), supplierId: id.nullable().optional(), sellerCompanyId: id.nullable().optional(), sourceOfferId: id.nullable().optional(), unitCost: money.nullable().optional() })).min(1).max(200) }),
  handler: (ctx, i) => draftFromSuggestions(ctx, i.picks),
});

// ── counts & transfers ──
export const startCountAction = defineAction({
  permission: MANAGE, schema: z.object({ addressId: id, kind: z.enum(["FULL", "CYCLE"]), offerIds: z.array(id).max(500).optional(), blind: z.boolean().optional(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => (await startCount(ctx, i)).id,
});
export const recordCountAction = defineAction({
  permission: MANAGE, schema: z.object({ id, entries: z.array(z.object({ lineId: id, countedQty: qty.nullable() })).max(5000) }),
  handler: async (ctx, i) => { await recordCount(ctx, i.id, i.entries); return true; },
});
export const addFoundLineAction = defineAction({
  permission: MANAGE, schema: z.object({ id, offerId: id, countedQty: z.number().int().min(1).max(10_000_000) }),
  handler: async (ctx, i) => (await addFoundLine(ctx, i.id, i)).id,
});
const countStep = z.object({ id, step: z.enum(["submit", "reopen", "approve", "cancel"]) });
export const countStepAction = defineAction({
  permission: MANAGE, schema: countStep,
  handler: async (ctx, i) => {
    if (i.step === "submit") await submitCount(ctx, i.id);
    else if (i.step === "reopen") await reopenCount(ctx, i.id);
    else if (i.step === "approve") await approveCount(ctx, i.id);
    else await cancelCount(ctx, i.id);
    return true;
  },
});
export const createTransferAction = defineAction({
  permission: MANAGE, schema: z.object({ fromAddressId: id, toAddressId: id, note: z.string().max(300).nullable().optional(), lines: z.array(z.object({ offerId: id, qty: z.number().int().min(1).max(10_000_000) })).min(1).max(200) }),
  handler: async (ctx, i) => (await createTransfer(ctx, i)).id,
});
export const transferStepAction = defineAction({
  permission: MANAGE, schema: z.object({ id, step: z.enum(["send", "cancel"]) }),
  handler: async (ctx, i) => { if (i.step === "send") await sendTransfer(ctx, i.id); else await cancelTransfer(ctx, i.id); return true; },
});
export const receiveTransferAction = defineAction({
  permission: MANAGE, schema: z.object({ id, lines: z.array(z.object({ lineId: id, qty })).max(200) }),
  handler: async (ctx, i) => { await receiveTransfer(ctx, i.id, i.lines); return true; },
});

// ── expiry features ──
export const requestFeatureAction = defineAction({
  permission: MANAGE, schema: z.object({ feature, enable: z.boolean(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => (await requestFeature(ctx, i.feature, i.enable, i.note)).id,
});
export const cancelFeatureRequestAction = defineAction({ permission: MANAGE, schema: z.object({ id }), handler: async (ctx, i) => { await cancelFeatureRequest(ctx, i.id); return true; } });
export const acceptMarkdownAction = defineAction({
  permission: MANAGE, schema: z.object({ batchId: id, percent: z.number().min(1).max(90) }),
  handler: async (ctx, i) => (await acceptMarkdown(ctx, i.batchId, i.percent)).id,
});

// ── FIRINGI ──
export const setSupplierFeatureAction = defineAction({
  permission: "admin.inventory.manage", schema: z.object({ companyId: id, feature, on: z.boolean(), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await setSupplierFeature(ctx, i.companyId, i.feature, i.on, i.note); return true; },
});
export const resetSupplierFeaturesAction = defineAction({ permission: "admin.inventory.manage", schema: z.object({ companyId: id }), handler: async (ctx, i) => { await resetSupplierFeatures(ctx, i.companyId); return true; } });
export const decideFeatureRequestAction = defineAction({
  permission: "admin.inventory.manage", schema: z.object({ id, approve: z.boolean(), reason: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => { await decideFeatureRequest(ctx, i.id, i.approve, i.reason); return true; },
});
export const setInventoryDefaultsAction = defineAction({
  permission: "admin.inventory.manage", schema: z.object({ fefo: z.boolean(), expiryAlerts: z.boolean(), markdown: z.boolean(), showExpiry: z.boolean() }),
  handler: async (ctx, i) => { await setDefaults(ctx, i); return true; },
});
