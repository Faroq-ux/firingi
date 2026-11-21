"use server";
/** WhatsApp ordering and small orders per month (Phase 58). Rights are checked again in the services. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as W from "@/server/whatsapp/ordering";
import * as Small from "@/server/orders/small-orders";
import { setCompanyFeature } from "@/server/accounting/features";

const id = z.string().min(1).max(64);
const adminDone = () => { revalidatePath("/admin/settings/whatsapp-ordering"); revalidatePath("/admin/notifications/whatsapp-ordering"); return true; };

export const saveWaSettingsAction = defineAction({
  permission: ["admin.settings.manage", "admin.messages.manage"],
  schema: z.object({
    enabled: z.boolean(),
    audiences: z.object({ customers: z.boolean(), wholesalers: z.boolean(), unknownNumbers: z.boolean() }),
    inputs: z.object({ photos: z.boolean(), voice: z.boolean(), buttons: z.boolean() }),
    draftMinutes: z.number().int().min(10).max(1440),
    pauseHours: z.number().int().min(1).max(168),
    hourlyLimit: z.number().int().min(1).max(500),
    orderUpdates: z.boolean(),
    payLinks: z.boolean(),
    reminders: z.object({ enabled: z.boolean(), daysBefore: z.number().int().min(0).max(7) }),
    templates: z.object({ orderUpdate: z.string().max(512).regex(/^[a-z0-9_]*$/, "Template names: lower-case letters, digits and _"), reminder: z.string().max(512).regex(/^[a-z0-9_]*$/, "Template names: lower-case letters, digits and _"), language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Language like pt_PT") }),
  }),
  handler: async (ctx, i) => { await W.saveWaSettings(ctx, i); return adminDone(); },
});

export const saveSmallOrderSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ enabled: z.boolean(), perMonth: z.number().int().min(0).max(100) }),
  handler: async (ctx, i) => { await Small.saveSmallOrderSettings(ctx, i); return adminDone(); },
});

export const setCompanySmallOrdersAction = defineAction({
  permission: ["admin.customers.manage", "admin.settings.manage"],
  schema: z.object({ companyId: id, perMonth: z.number().int().min(0).max(100).nullable(), unlimited: z.boolean() }),
  handler: async (ctx, i) => { await Small.setCompanySmallOrders(ctx, i.companyId, { perMonth: i.perMonth, unlimited: i.unlimited }); return adminDone(); },
});

export const setCompanyWhatsAppAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ companyId: id, enabled: z.boolean() }),
  handler: async (ctx, i) => { await setCompanyFeature(ctx, i.companyId, "WHATSAPP_ORDERING", i.enabled); return adminDone(); },
});

export const pauseWaConversationAction = defineAction({
  permission: ["admin.messages.manage", "admin.settings.manage"],
  schema: z.object({ conversationId: id, pause: z.boolean() }),
  handler: async (ctx, i) => { await W.setConversationPause(ctx, i.conversationId, i.pause); return adminDone(); },
});

export const saveMyWhatsAppAction = defineAction({
  permission: ["company.profile.manage", "buyer.orders.place"],
  schema: z.object({ orderUpdates: z.boolean(), reminders: z.boolean() }),
  handler: async (ctx, i) => { await W.saveMyWhatsApp(ctx, i); revalidatePath("/buy/company/whatsapp"); return true; },
});
