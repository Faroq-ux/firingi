"use server";
/** Warehouse operations & traceability (Phase 25): shelves, scanning, pick & pack, recalls. */
import { z } from "zod";
import { getLocale } from "next-intl/server";
import { defineAction } from "./_action";
import { createBin, createBinRange, putAway, updateBin } from "@/server/warehouse/bins";
import { resolveScan } from "@/server/warehouse/scan";
import { cancelPickList, confirmPick, createPickList, packOrder, reportShort, scanPick } from "@/server/warehouse/picking";
import { acknowledgeRecall, closeRecall, reportRecallAction, startRecall, traceableLots } from "@/server/warehouse/recalls";

const id = z.string().min(1).max(40);
const MANAGE = "vendor.inventory.manage" as const;
const PICK = ["vendor.warehouse.pick", "vendor.inventory.manage"] as const;
const SEE = ["vendor.inventory.view", "vendor.inventory.manage", "vendor.warehouse.pick"] as const;
const RECALL = ["vendor.recalls.manage", "admin.recalls.manage"] as const;
const TRACE = ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage", "admin.inventory.view", "admin.inventory.manage", "admin.recalls.manage"] as const;
const BUYER = ["buyer.orders.view", "buyer.orders.place", "vendor.inventory.view", "vendor.inventory.manage"] as const;

// ── shelves ──
export const createBinAction = defineAction({
  permission: MANAGE, schema: z.object({ addressId: id, code: z.string().min(1).max(24), zone: z.string().max(40).nullable().optional(), sortOrder: z.number().int().min(0).max(999999).nullable().optional() }),
  handler: async (ctx, i) => (await createBin(ctx, i)).id,
});
export const createBinRangeAction = defineAction({
  permission: MANAGE, schema: z.object({ addressId: id, aisles: z.string().min(1).max(80), racks: z.number().int().min(1).max(99), levels: z.number().int().min(1).max(9), zone: z.string().max(40).nullable().optional() }),
  handler: async (ctx, i) => createBinRange(ctx, i),
});
export const updateBinAction = defineAction({
  permission: MANAGE, schema: z.object({ id, zone: z.string().max(40).nullable().optional(), sortOrder: z.number().int().min(0).max(999999).nullable().optional(), isActive: z.boolean().optional() }),
  handler: async (ctx, i) => { await updateBin(ctx, i); return true; },
});
export const putAwayAction = defineAction({
  permission: [...PICK], schema: z.object({ batchId: id, binId: id, qty: z.number().int().min(1).max(10_000_000).nullable().optional() }),
  handler: async (ctx, i) => putAway(ctx, i),
});

// ── scanning ──
export const resolveScanAction = defineAction({
  permission: [...SEE], schema: z.object({ code: z.string().min(1).max(200) }),
  handler: async (ctx, i) => resolveScan(ctx, i.code, await getLocale()),
});

// ── pick & pack ──
export const createPickListAction = defineAction({
  permission: [...PICK], schema: z.object({ addressId: id, orderIds: z.array(id).min(1).max(50), note: z.string().max(300).nullable().optional() }),
  handler: async (ctx, i) => createPickList(ctx, i),
});
export const scanPickAction = defineAction({
  permission: [...PICK], schema: z.object({ lineId: id, code: z.string().min(1).max(200), qty: z.number().int().min(1).max(100_000).optional() }),
  handler: async (ctx, i) => scanPick(ctx, i.lineId, i.code, i.qty ?? 1),
});
export const confirmPickAction = defineAction({
  permission: [...PICK], schema: z.object({ lineId: id, qty: z.number().int().min(0).max(10_000_000) }),
  handler: async (ctx, i) => { await confirmPick(ctx, i.lineId, i.qty); return true; },
});
export const reportShortAction = defineAction({
  permission: [...PICK], schema: z.object({ lineId: id, found: z.number().int().min(0).max(10_000_000), reason: z.string().min(1).max(200) }),
  handler: async (ctx, i) => reportShort(ctx, i.lineId, i),
});
export const packOrderAction = defineAction({
  permission: [...PICK], schema: z.object({ pickListId: id, orderId: id, boxes: z.number().int().min(1).max(999) }),
  handler: async (ctx, i) => { await packOrder(ctx, i); return true; },
});
export const cancelPickListAction = defineAction({
  permission: [...PICK], schema: z.object({ id }),
  handler: async (ctx, i) => { await cancelPickList(ctx, i.id); return true; },
});

// ── traceability & recalls ──
export const traceableLotsAction = defineAction({
  permission: [...TRACE], schema: z.object({ offerId: id }),
  handler: async (ctx, i) => traceableLots(ctx, i.offerId),
});
export const startRecallAction = defineAction({
  permission: [...RECALL],
  schema: z.object({ offerId: id, lotCode: z.string().max(60).nullable().optional(), batchId: id.nullable().optional(), recallClass: z.enum(["CLASS_I", "CLASS_II", "CLASS_III"]), reason: z.string().min(1).max(500), instructions: z.string().max(1000).nullable().optional() }),
  handler: async (ctx, i) => startRecall(ctx, i),
});
export const closeRecallAction = defineAction({
  permission: [...RECALL], schema: z.object({ id, note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await closeRecall(ctx, i.id, i.note); return true; },
});
export const acknowledgeRecallAction = defineAction({
  permission: [...BUYER], schema: z.object({ id }),
  handler: async (ctx, i) => { await acknowledgeRecall(ctx, i.id); return true; },
});
export const reportRecallNoticeAction = defineAction({
  permission: [...BUYER], schema: z.object({ id, returnedQty: z.number().int().min(0).max(10_000_000), destroyedQty: z.number().int().min(0).max(10_000_000), noneLeft: z.boolean(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await reportRecallAction(ctx, i.id, i); return true; },
});
