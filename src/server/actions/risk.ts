"use server";
/** Risk reviews, risk settings, approvals (services re-check permissions). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as risk from "@/server/risk/service";
import * as approvals from "@/server/approvals/service";
import { setLegalEntityIban } from "@/server/services/payments";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const note = z.string().trim().max(500).optional().nullable();

export const decideHeldAction = defineAction({ permission: "admin.risk.manage", schema: z.object({ orderId: z.string(), decision: z.enum(["RELEASE", "CANCEL"]), note }), handler: async (ctx, i) => done(await risk.decideHeld(ctx, i.orderId, i.decision, i.note ?? null)) });
export const reviewRiskAction = defineAction({ permission: "admin.risk.manage", schema: z.object({ id: z.string(), verdict: z.enum(["CLEARED", "FRAUD"]), note }), handler: async (ctx, i) => done(await risk.reviewAssessment(ctx, i.id, i.verdict, i.note ?? null)) });
const RULES = ["NEW_ACCOUNT_BIG", "FIRST_ORDER_BIG", "VELOCITY", "SPIKE", "FAR_ADDRESS", "NEW_ADDRESS", "NEW_USER", "COUPON_SHARED", "CANCEL_HISTORY"] as const;
export const saveRiskSettingsAction = defineAction({
  permission: "admin.risk.manage",
  schema: z.object({
    enabled: z.boolean(), holdScore: z.coerce.number(), flagScore: z.coerce.number(), newAccountDays: z.coerce.number(), bigOrderAmount: z.coerce.number(),
    velocityOrders: z.coerce.number(), velocityMinutes: z.coerce.number(), spikeFactor: z.coerce.number(), farKm: z.coerce.number(), disabledRules: z.array(z.enum(RULES)),
  }),
  handler: async (ctx, i) => done(await risk.saveRiskSettings(ctx, i)),
});
export const decideApprovalAction = defineAction({ permission: null, schema: z.object({ id: z.string(), approve: z.boolean(), reason: note }), handler: async (ctx, i) => done(await approvals.decideApproval(ctx, i.id, i.approve, i.reason ?? null)) });
export const withdrawApprovalAction = defineAction({ permission: null, schema: z.object({ id: z.string() }), handler: async (ctx, i) => done(await approvals.withdrawApproval(ctx, i.id)) });
export const saveApprovalSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), creditNoteAbove: z.coerce.number(), creditLimitAbove: z.coerce.number(), paymentDaysAbove: z.coerce.number(), commissionChanges: z.boolean(),
    offerPercentAbove: z.coerce.number(), offerAmountAbove: z.coerce.number(), bankDetails: z.boolean(), staffRoles: z.boolean(), paymentAbove: z.coerce.number(),
  }),
  handler: async (ctx, i) => done(await approvals.saveApprovalSettings(ctx, i)),
});
export const setIbanAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ legalEntityId: z.string(), iban: z.string().trim().min(10).max(42) }), handler: async (ctx, i) => done(await setLegalEntityIban(ctx, i.legalEntityId, i.iban)) });
