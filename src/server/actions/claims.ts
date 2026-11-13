"use server";
/** Quality claim actions (Phase 31). Permissions are checked again inside the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as svc from "@/server/claims/service";

const done = <T>(v: T) => { revalidatePath("/buy/orders", "layout"); revalidatePath("/vendor/orders", "layout"); revalidatePath("/admin/orders", "layout"); return v; };
const id = z.string().min(1).max(64);
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const files = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
const REASONS = ["DAMAGED", "MISSING", "WRONG_PRODUCT", "TEMPERATURE", "SHORT_DATED", "QUALITY"] as const;

/** Customer: report a problem (multipart: lines as "orderLineId:qty:lot", photos). */
export async function createClaimAction(fd: FormData) {
  return runAction(async (ctx) => {
    const reason = z.enum(REASONS).parse(str(fd.get("reason")));
    const preferredOutcome = z.enum(["CREDIT", "REPLACEMENT"]).parse(str(fd.get("preferredOutcome")) || "CREDIT");
    const lines = fd.getAll("line").map((v) => {
      const [orderLineId, qty, ...lot] = String(v).split(":");
      return { orderLineId, qty: Number(qty), lotCode: lot.join(":") || null };
    });
    const c = await svc.createClaim(ctx, str(fd.get("orderId")), { reason, preferredOutcome, description: str(fd.get("description")).slice(0, 4000), lines, photos: files(fd, "photos") });
    return done({ id: c.id, number: c.number });
  });
}

export async function addClaimMessageAction(fd: FormData) {
  return runAction(async (ctx) => {
    const m = await svc.addClaimMessage(ctx, str(fd.get("claimId")), { body: str(fd.get("body")).slice(0, 4000), internal: str(fd.get("internal")) === "1", photos: files(fd, "photos") });
    return done(m.id);
  });
}

export async function respondClaimAction(fd: FormData) {
  return runAction(async (ctx) => {
    const response = z.enum(["ACCEPTED", "DISPUTED"]).parse(str(fd.get("response")));
    await svc.respondAsSupplier(ctx, str(fd.get("claimId")), { response, comment: str(fd.get("comment")).slice(0, 4000), photos: files(fd, "photos") });
    return done(null);
  });
}

export const withdrawClaimAction = defineAction({
  permission: "buyer.claims.manage",
  schema: z.object({ id }),
  handler: async (ctx, i) => done(await svc.withdrawClaim(ctx, i.id)),
});

export const decideClaimAction = defineAction({
  permission: "admin.claims.manage",
  schema: z.object({
    id, decision: z.enum(["APPROVE", "REJECT"]), outcome: z.enum(["CREDIT", "REPLACEMENT"]).optional(), fault: z.enum(["SUPPLIER", "DRIVER", "FIRINGI", "CUSTOMER"]),
    lines: z.array(z.object({ lineId: id, approvedQty: z.number().int().min(0).max(1_000_000) })).max(200).optional(),
    creditDeliveryFee: z.boolean().optional(), driverAmount: z.number().min(0).max(10_000).nullable().optional(), note: z.string().trim().max(2000).nullable().optional(),
  }),
  handler: async (ctx, { id: claimId, ...input }) => done(await svc.decideClaim(ctx, claimId, input)),
});

export const markReplacementDoneAction = defineAction({
  permission: ["vendor.claims.respond", "admin.claims.manage"],
  schema: z.object({ id }),
  handler: async (ctx, i) => done(await svc.markReplacementDone(ctx, i.id)),
});

export const disputeChargebackAction = defineAction({
  permission: "vendor.claims.respond",
  schema: z.object({ id, note: z.string().trim().max(2000) }),
  handler: async (ctx, i) => done(await svc.disputeChargeback(ctx, i.id, i.note)),
});

export const resolveChargebackAction = defineAction({
  permission: "admin.claims.manage",
  schema: z.object({ id, action: z.enum(["UPHOLD", "WAIVE", "DEDUCTED"]), note: z.string().trim().max(2000).nullable().optional() }),
  handler: async (ctx, i) => done(await svc.resolveChargeback(ctx, i.id, i)),
});

export const acknowledgeAlertAction = defineAction({
  permission: "admin.claims.manage",
  schema: z.object({ id }),
  handler: async (ctx, i) => done(await svc.acknowledgeAlert(ctx, i.id)),
});

export const saveClaimSettingsAction = defineAction({
  permission: "admin.claims.manage",
  schema: z.object({
    windowHours: z.number(), slaHours: z.number(), supplierResponseHours: z.number(), photoReasons: z.array(z.enum(REASONS)),
    supplierRatePct: z.number(), productRatePct: z.number(), lotClaims: z.number(), driverClaims: z.number(), minDeliveries: z.number(),
  }),
  handler: async (ctx, i) => done(await svc.saveClaimSettings(ctx, i)),
});

export const claimPreviewAction = defineAction({
  permission: "admin.claims.manage",
  schema: z.object({ id, lines: z.array(z.object({ lineId: id, approvedQty: z.number().int().min(0) })).max(200), creditDeliveryFee: z.boolean() }),
  handler: async (_ctx, i) => (await svc.creditPreview(i.id, i)).gross,
});
