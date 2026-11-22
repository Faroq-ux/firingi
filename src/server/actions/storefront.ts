"use server";
/** Storefronts (Phase 61). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as S from "@/server/storefront/service";

function refresh() {
  revalidatePath("/vendor/company/storefront");
  revalidatePath("/admin/vendors/storefronts");
  revalidatePath("/s", "layout");
  revalidatePath("/buy/catalogue", "layout");
}

export const saveStorefrontAction = defineAction({
  permission: null,
  schema: z.object({ slug: z.string().trim().min(1).max(60), tagline: z.string().max(200).nullable().optional(), about: z.string().max(4000).nullable().optional(), accent: z.string().max(10).nullable().optional(), featuredOfferIds: z.array(z.string().min(1).max(64)).max(24).optional(), showProducts: z.boolean().optional() }),
  handler: async (ctx, i) => { await S.saveStorefront(ctx, i); refresh(); return true; },
});

/** Logo / banner picture (multipart: kind, file). */
export async function uploadStorefrontImageAction(fd: FormData) {
  return runAction(async (ctx) => {
    const kind = z.enum(["logo", "banner"]).parse(String(fd.get("kind") ?? ""));
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new (await import("@/server/errors")).ValidationError("Please choose a picture.");
    await S.uploadStorefrontImage(ctx, kind, f);
    refresh();
    return true;
  });
}

export const removeStorefrontImageAction = defineAction({
  permission: null, schema: z.object({ kind: z.enum(["logo", "banner"]) }),
  handler: async (ctx, i) => { await S.removeStorefrontImage(ctx, i.kind); refresh(); return true; },
});

export const publishStorefrontAction = defineAction({
  permission: null, schema: z.object({}),
  handler: async (ctx) => { const r = await S.publishStorefront(ctx); refresh(); return r; },
});

export const unpublishStorefrontAction = defineAction({
  permission: null, schema: z.object({}),
  handler: async (ctx) => { await S.unpublishStorefront(ctx); refresh(); return true; },
});

export const decideStorefrontAction = defineAction({
  permission: null,
  schema: z.object({ companyId: z.string().min(1).max(64), action: z.enum(["APPROVE", "REJECT", "SUSPEND", "RESTORE"]), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await S.decideStorefront(ctx, i.companyId, i.action, i.note ?? null); refresh(); return r; },
});

export const saveStorefrontSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ enabled: z.boolean(), requireApproval: z.boolean(), publicProducts: z.boolean(), maxFeatured: z.number().int().min(0).max(24) }),
  handler: async (ctx, i) => { await S.saveStorefrontSettings(ctx, i); refresh(); return true; },
});
