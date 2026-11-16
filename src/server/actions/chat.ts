"use server";
/** Order chat actions (Phase 35). Who may read / write is checked again inside the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as svc from "@/server/chat/service";
import { CHAT_CHANNELS } from "@/lib/chat";
import { AI_MODELS } from "@/lib/ai";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const files = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
const PORTAL = z.enum(["buy", "vendor", "admin", "driver"]);
const CHANNEL = z.enum(CHAT_CHANNELS);

/** Send a message (multipart: orderId, portal, channel, body, locale, photos). */
export async function sendChatMessageAction(fd: FormData) {
  return runAction(async (ctx) => {
    const portal = PORTAL.parse(str(fd.get("portal")));
    const r = await svc.sendOrderMessage(ctx, str(fd.get("orderId")), portal, {
      channel: CHANNEL.parse(str(fd.get("channel"))), body: str(fd.get("body")).slice(0, 4000), locale: str(fd.get("locale")).slice(0, 10) || undefined, photos: files(fd, "photos"),
    });
    revalidatePath("/", "layout");
    return r;
  });
}

/** Mark a conversation read (opening it). */
export async function markChatReadAction(input: { orderId: string; channel: string; portal: string }) {
  return runAction(async (ctx) => {
    const i = z.object({ orderId: z.string().min(1).max(64), channel: CHANNEL, portal: PORTAL }).parse(input);
    return svc.markThreadRead(ctx, i.orderId, i.channel, i.portal);
  });
}

export const saveChatSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), maskContacts: z.boolean(), translate: z.boolean(), photos: z.boolean(),
    translateModel: z.enum(AI_MODELS), driverHoursAfter: z.coerce.number().int(), closeDaysAfter: z.coerce.number().int(),
    channels: z.object({ BUYER_SUPPLIER: z.boolean(), BUYER_FIRINGI: z.boolean(), SUPPLIER_FIRINGI: z.boolean(), DRIVER: z.boolean() }),
  }),
  handler: async (ctx, i) => { await svc.saveChatSettings(ctx, i); revalidatePath("/admin/orders/chat", "layout"); return true; },
});

export const reviewFlaggedAction = defineAction({
  permission: ["admin.orders.manage", "admin.support.manage", "admin.settings.manage"],
  schema: z.object({ id: z.string().min(1).max(64) }),
  handler: async (ctx, i) => { await svc.reviewFlagged(ctx, i.id); revalidatePath("/admin/orders/chat", "layout"); return true; },
});
