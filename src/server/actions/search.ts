"use server";
/** Phase 72: FIRINGI's smart-search settings and synonym list. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as S from "@/server/search/service";

const CAT = ["admin.catalogue.manage"] as const;
const re = <T,>(v: T) => { revalidatePath("/admin/catalogue/search"); revalidatePath("/buy/catalogue/search"); return v; };

export const saveSearchSettingsAction = defineAction({
  permission: [...CAT],
  schema: z.object({ fuzzy: z.boolean(), typo: z.number().min(0.3).max(0.8), ai: z.boolean(), synonyms: z.boolean(), filters: z.boolean() }),
  handler: async (ctx, i) => re(await S.saveSearchSettings(ctx, i)),
});
export const saveSynonymAction = defineAction({
  permission: [...CAT],
  schema: z.object({ id: z.string().max(40).nullable().optional(), term: z.string().min(1).max(60), alternatives: z.array(z.string().max(60)).max(40), hidden: z.boolean().optional() }),
  handler: async (ctx, i) => re((await S.saveSynonym(ctx, i)).id),
});
export const deleteSynonymAction = defineAction({
  permission: [...CAT], schema: z.object({ id: z.string().min(1).max(40) }),
  handler: async (ctx, i) => re(await S.deleteSynonym(ctx, i.id)),
});
