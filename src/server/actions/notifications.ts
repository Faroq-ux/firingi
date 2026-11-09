"use server";
/** Notification actions: bell, preferences, push devices, and the back office. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as n from "@/server/services/notifications";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const channel = z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"]);

export const markReadAction = defineAction({ permission: null, schema: z.object({ id: z.string() }), handler: async (ctx, i) => done(await n.markRead(ctx, i.id)) });
export const savePreferencesAction = defineAction({
  permission: null,
  schema: z.object({ prefs: z.array(z.object({ category: z.string(), channel, enabled: z.boolean() })).max(60), phone: z.string().max(40).optional().nullable(), smsConsent: z.boolean(), whatsappConsent: z.boolean() }),
  handler: async (ctx, i) => done(await n.savePreferences(ctx, i)),
});
export const subscribePushAction = defineAction({
  permission: null,
  schema: z.object({ endpoint: z.string().url().max(1000), p256dh: z.string().max(200), auth: z.string().max(100), userAgent: z.string().max(300).optional().nullable() }),
  handler: async (ctx, i) => done(await n.subscribePush(ctx, i)),
});
export const unsubscribePushAction = defineAction({ permission: null, schema: z.object({ endpoint: z.string().max(1000) }), handler: async (ctx, i) => done(await n.unsubscribePush(ctx, i.endpoint)) });

// back office
export const setChannelEnabledAction = defineAction({ permission: "admin.notifications.manage", schema: z.object({ channel, enabled: z.boolean() }), handler: async (ctx, i) => done(await n.setChannelEnabled(ctx, i.channel, i.enabled)) });
export const setEventChannelsAction = defineAction({
  permission: "admin.notifications.manage",
  schema: z.object({ eventKey: z.string(), channels: z.array(channel).nullable() }),
  handler: async (ctx, i) => done(await n.setEventChannels(ctx, i.eventKey, i.channels)),
});
export const saveTemplateAction = defineAction({
  permission: "admin.notifications.manage",
  schema: z.object({ eventKey: z.string(), channel, locale: z.string(), subject: z.string().max(200).optional().nullable(), body: z.string().max(4000), waTemplateName: z.string().max(120).optional().nullable(), waLanguage: z.string().max(20).optional().nullable(), isActive: z.boolean() }),
  handler: async (ctx, i) => done(await n.saveTemplate(ctx, i)),
});
export const resetTemplateAction = defineAction({ permission: "admin.notifications.manage", schema: z.object({ eventKey: z.string(), channel, locale: z.string() }), handler: async (ctx, i) => done(await n.resetTemplate(ctx, i.eventKey, i.channel, i.locale)) });
export const testSendAction = defineAction({ permission: "admin.notifications.manage", schema: z.object({ channel, to: z.string().max(200), text: z.string().max(1000) }), handler: async (ctx, i) => done((await n.testSend(ctx, i.channel, i.to, i.text))?.status ?? null) });
export const retryMessageAction = defineAction({ permission: "admin.notifications.manage", schema: z.object({ id: z.string() }), handler: async (ctx, i) => done((await n.retryMessage(ctx, i.id))?.status ?? null) });
export const runOutboxAction = defineAction({ permission: "admin.notifications.manage", schema: z.object({}), handler: async (ctx) => done(await n.runOutbox(ctx)) });
export const replyAction = defineAction({
  permission: ["admin.messages.manage", "admin.notifications.manage"],
  schema: z.object({ from: z.string(), channel: z.enum(["SMS", "WHATSAPP"]), text: z.string().max(1600) }),
  handler: async (ctx, i) => done((await n.reply(ctx, i.from, i.channel, i.text))?.status ?? null),
});
export const markHandledAction = defineAction({ permission: ["admin.messages.manage", "admin.notifications.manage"], schema: z.object({ from: z.string() }), handler: async (ctx, i) => done(await n.markHandled(ctx, i.from)) });
