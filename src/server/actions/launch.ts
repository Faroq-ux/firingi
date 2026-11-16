"use server";
/** Launch (Phase 33): readiness settings, FIRINGI legal entities, pilot invitations. Every service re-checks access. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as svc from "@/server/launch/service";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };

export const saveLaunchSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ termsUrl: z.string().max(500), privacyUrl: z.string().max(500), supportEmail: z.string().max(200), pilot: z.boolean(), pilotBanner: z.boolean() }).partial(),
  handler: async (ctx, i) => done(await svc.saveLaunchSettings(ctx, i)),
});

const entity = z.object({
  countryCode: z.string().length(2), legalName: z.string().max(200), taxId: z.string().max(20), vatNumber: z.string().max(20),
  addressLine: z.string().max(200), postalCode: z.string().max(12), city: z.string().max(100), email: z.string().max(200), phone: z.string().max(30),
});
export const saveLegalEntityAction = defineAction({
  permission: "admin.settings.manage", schema: entity.extend({ id: z.string().optional() }),
  handler: async (ctx, { id, ...i }) => { const r = await svc.saveLegalEntity(ctx, i, id); return done({ id: r.id }); },
});

export const createInviteAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ email: z.string().max(200), companyName: z.string().max(200), type: z.enum(["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"]), countryCode: z.string().length(2), days: z.number().int().min(1).max(180), note: z.string().max(300).nullable().optional(), send: z.boolean() }),
  handler: async (ctx, i) => { const r = await svc.createInvite(ctx, i); return done({ id: r.id, code: r.code, link: r.link }); },
});
export const sendInviteAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => { const r = await svc.sendInvite(ctx, i.id); return done({ link: r.link }); } });
export const revokeInviteAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => { await svc.revokeInvite(ctx, i.id); return done(true); } });
