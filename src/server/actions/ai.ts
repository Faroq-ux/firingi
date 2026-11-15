"use server";
/** AI Centre: suggestions, refresh, buy again, assistant, settings (services re-check access). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as feed from "@/server/ai/feed";
import * as assistant from "@/server/ai/assistant";
import { AI_MODELS } from "@/lib/ai";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const side = z.enum(["STAFF", "VENDOR", "BUYER"]);

export const decideRecommendationAction = defineAction({ permission: null, schema: z.object({ id: z.string(), accept: z.boolean(), note: z.string().trim().max(500).optional().nullable() }), handler: async (ctx, i) => done(await feed.decideRecommendation(ctx, i.id, i.accept, i.note ?? null)) });
export const refreshAiAction = defineAction({ permission: "admin.ai.view", schema: z.object({}), handler: async () => done(await feed.refreshRecommendations()) });
export const buyAgainAction = defineAction({ permission: "buyer.orders.place", schema: z.object({ sellerId: z.string(), locale: z.string().max(10).optional() }), handler: async (ctx, i) => done(await feed.buyAgain(ctx, i.sellerId, i.locale)) });
export const askAssistantAction = defineAction({
  permission: null,
  schema: z.object({ side, conversationId: z.string().optional().nullable(), text: z.string().max(4000), locale: z.string().max(10).optional() }),
  handler: async (ctx, i) => {
    const r = await assistant.ask(ctx, i.side, { conversationId: i.conversationId ?? null, text: i.text, locale: i.locale });
    return { conversationId: r.conversationId, messageId: r.messageId, answer: r.answer, tools: r.tools.map((t) => ({ name: t.name, ok: t.ok, ...(t.card ? { card: t.card } : {}) })), model: r.model, fellBack: r.fellBack };
  },
});
export const handoverAction = defineAction({
  permission: "company.support.use",
  schema: z.object({ side: z.enum(["VENDOR", "BUYER"]), messageId: z.string().min(1) }),
  handler: async (ctx, i) => { const r = await assistant.handoverToSupport(ctx, i.side, i.messageId); revalidatePath("/", "layout"); return r; },
});
export const deleteConversationAction = defineAction({ permission: null, schema: z.object({ side, id: z.string() }), handler: async (ctx, i) => done(await assistant.deleteConversation(ctx, i.side, i.id)) });
export const saveAiSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ model: z.enum(AI_MODELS), staff: z.boolean(), buyers: z.boolean(), suppliers: z.boolean(), hourlyLimit: z.coerce.number().int() }),
  handler: async (ctx, i) => done(await assistant.saveAiSettings(ctx, i)),
});
