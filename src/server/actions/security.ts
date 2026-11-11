"use server";
/** Phase 11: sessions, security policy, admin resets. (2FA itself goes through better-auth's API.) */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { setPaymentPolicy } from "@/server/services/payments";
import { updatePlatformSettings } from "@/server/services/platform-settings";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import { completeErasure, rejectErasure, requestErasure, withdrawErasure } from "@/server/services/privacy";
import { endOtherSessions, endSession, resetTwoFactor, setSecurityPolicy, signOutEverywhere } from "@/server/services/security";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };

export const endSessionAction = defineAction({ permission: null, schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => done(await endSession(ctx, i.id)) });
export const endOtherSessionsAction = defineAction({ permission: null, schema: z.object({}), handler: async (ctx) => done(await endOtherSessions(ctx)) });
export const setSecurityPolicyAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ requireTwoFactorStaff: z.boolean(), requireTwoFactorOwners: z.boolean(), maxSessionHours: z.coerce.number().int() }),
  handler: async (ctx, i) => done(await setSecurityPolicy(ctx, i)),
});
export const signOutEverywhereAction = defineAction({ permission: ["admin.settings.manage", "admin.users.manage"], schema: z.object({ userId: z.string().min(1) }), handler: async (ctx, i) => done(await signOutEverywhere(ctx, i.userId)) });
export const resetTwoFactorAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ userId: z.string().min(1) }), handler: async (ctx, i) => done(await resetTwoFactor(ctx, i.userId)) });

// ── data privacy ──
export const requestErasureAction = defineAction({ permission: null, schema: z.object({ reason: z.string().max(500).optional().nullable() }), handler: async (ctx, i) => done((await requestErasure(ctx, i.reason)).id) });
export const withdrawErasureAction = defineAction({ permission: null, schema: z.object({}), handler: async (ctx) => done(await withdrawErasure(ctx)) });
export const completeErasureAction = defineAction({ permission: ["admin.users.manage", "admin.settings.manage"], schema: z.object({ id: z.string().min(1), note: z.string().max(500).optional().nullable() }), handler: async (ctx, i) => done(await completeErasure(ctx, i.id, i.note)) });
export const rejectErasureAction = defineAction({ permission: ["admin.users.manage", "admin.settings.manage"], schema: z.object({ id: z.string().min(1), note: z.string().min(1).max(500) }), handler: async (ctx, i) => done(await rejectErasure(ctx, i.id, i.note)) });

// ── payments ──
export const setPaymentPolicyAction = defineAction({
  permission: ["admin.settings.manage", "admin.finance.manage"],
  schema: z.object({
    methods: z.record(z.string(), z.boolean()), mbWayPhone: z.string().nullable(), overdueBlockDays: z.number().int().nullable(), creditCheck: z.boolean(),
    defaultTermsDays: z.object({ CUSTOMER: z.number().int(), WHOLESALER: z.number().int() }),
    defaultCreditLimit: z.object({ CUSTOMER: z.number().nullable(), WHOLESALER: z.number().nullable() }),
    supplierPayoutDays: z.number().int().optional(),
  }),
  handler: async (ctx, i) => done(await setPaymentPolicy(ctx, i as Parameters<typeof setPaymentPolicy>[1])),
});

// ── platform settings & API keys ──
export const updatePlatformSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ patch: z.record(z.string(), z.unknown()) }),
  handler: async (ctx, i) => done(await updatePlatformSettings(ctx, i.patch as Parameters<typeof updatePlatformSettings>[1])),
});
export const createApiKeyAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ companyId: z.string().min(1), userId: z.string().min(1), name: z.string().max(80), scopes: z.array(z.string()).max(10) }),
  handler: async (ctx, i) => done(await createApiKey(ctx, i)),
});
export const revokeApiKeyAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ id: z.string().min(1) }), handler: async (ctx, i) => done(await revokeApiKey(ctx, i.id)) });
