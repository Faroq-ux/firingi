"use server";
/** Saved table views and personal preferences (any signed-in member). */
import { z } from "zod";
import { defineAction } from "./_action";
import { deleteView, saveView, setPreference } from "@/server/services/workspace";

export const saveViewAction = defineAction({
  permission: null,
  schema: z.object({ tableId: z.string().max(60), name: z.string().min(1).max(60), state: z.unknown(), isDefault: z.boolean().optional() }),
  handler: (ctx, i) => saveView(ctx, { ...i, state: i.state ?? {} }),
});
export const deleteViewAction = defineAction({ permission: null, schema: z.object({ id: z.string().min(1).max(40) }), handler: async (ctx, i) => { await deleteView(ctx, i.id); return true; } });
export const setPreferenceAction = defineAction({
  permission: null, schema: z.object({ key: z.string().max(60), value: z.unknown() }),
  handler: async (ctx, i) => { await setPreference(ctx, i.key, i.value ?? null); return true; },
});
