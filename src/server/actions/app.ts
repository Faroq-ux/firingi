"use server";
/** Phase 39 actions: scan to reorder (buyers), the app settings (FIRINGI). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { defineAction } from "./_action";
import { scanToCart } from "@/server/app/scan";
import { saveAppSettings } from "@/server/app/service";

export const scanToCartAction = defineAction({
  permission: "buyer.orders.place",
  schema: z.object({ code: z.string().min(1).max(64) }),
  handler: async (ctx, i) => { const r = await scanToCart(ctx, i.code, await getLocale()); if (r.status === "ADDED") revalidatePath("/buy", "layout"); return r; },
});

const portals = z.object({ buy: z.boolean(), vendor: z.boolean(), driver: z.boolean(), admin: z.boolean() });
export const saveAppSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    portals, installPrompt: z.boolean(),
    offlineOrders: z.object({ mode: z.enum(["ASK", "AUTO"]), maxChangePct: z.number() }),
    snapshot: z.object({ products: z.number(), orders: z.number(), invoices: z.number(), documents: z.number() }),
    refreshMinutes: z.number(),
  }),
  handler: async (ctx, i) => { const v = await saveAppSettings(ctx, i); revalidatePath("/", "layout"); return v; },
});
