"use server";
/** Menu costing & food waste actions (Phase 54). The service checks rights again (manager / waste logger, FIRINGI's switches). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as K from "@/server/kitchen/service";
import { BASE_UNITS, COST_BASES, KITCHEN_PARTS, KITCHEN_TYPES, LINE_UNITS, ROUNDINGS, WASTE_REASONS, WASTE_UNITS } from "@/lib/kitchen";

const id = z.string().min(1).max(64);
const num = z.number().finite();
const done = <T>(v: T) => { revalidatePath("/buy/kitchen", "layout"); revalidatePath("/admin/settings/kitchen"); revalidatePath("/admin/kitchen"); return v; };
const ANY_KITCHEN = ["buyer.kitchen.manage", "buyer.kitchen.waste"] as const;

export const addIngredientFromPurchaseAction = defineAction({
  permission: "buyer.kitchen.manage",
  schema: z.object({ productId: id, name: z.string().max(120).nullable(), unit: z.enum(BASE_UNITS).nullable(), packSize: num.nullable() }),
  handler: async (ctx, i) => done(await K.addIngredientFromPurchase(ctx, i)),
});
export const saveIngredientAction = defineAction({
  permission: "buyer.kitchen.manage",
  schema: z.object({
    id: id.nullable(), name: z.string().max(120), unit: z.enum(BASE_UNITS), manualCost: num.nullable(), supplierName: z.string().max(120).nullable(), yieldPct: num,
    allergens: z.array(z.string().max(20)).max(30), allergensOwn: z.boolean(), co2PerUnit: num.nullable(), packSize: num.nullable(), active: z.boolean(),
  }),
  handler: async (ctx, i) => done(await K.saveIngredient(ctx, i)),
});
export const deleteIngredientAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({ id }), handler: async (ctx, i) => done(await K.deleteIngredient(ctx, i.id)) });

export const saveRecipeAction = defineAction({
  permission: "buyer.kitchen.manage",
  schema: z.object({
    id: id.nullable(), name: z.string().max(120), kind: z.enum(["DISH", "SUB"]), category: z.string().max(60).nullable(), posItemId: id.nullable(), yieldQty: num, yieldUnit: z.enum(BASE_UNITS).nullable(),
    priceGross: num.nullable(), vatRate: num, targetPct: num.nullable(), soldPerWeek: num.nullable(), notes: z.string().max(2000).nullable(), active: z.boolean(),
    lines: z.array(z.object({ ingredientId: id.nullable(), subRecipeId: id.nullable(), qty: num, unit: z.enum(LINE_UNITS) })).max(80),
  }),
  handler: async (ctx, i) => done(await K.saveRecipe(ctx, i)),
});
export const deleteRecipeAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({ id }), handler: async (ctx, i) => done(await K.deleteRecipe(ctx, i.id)) });
export const applySuggestedPriceAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({ id }), handler: async (ctx, i) => done(await K.applySuggestedPrice(ctx, i.id)) });
export const pushAllergensAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({ id }), handler: async (ctx, i) => done(await K.pushAllergensToTill(ctx, i.id)) });
export const importFromTillAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({}), handler: async (ctx) => done(await K.importFromTill(ctx)) });
export const refreshCostsAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({}), handler: async (ctx) => done((await K.refreshCosts(ctx.company.id, { ctx })).length) });
export const whatIfAction = defineAction({ permission: "buyer.kitchen.manage", schema: z.object({ ingredientId: id, risePct: num }), handler: async (ctx, i) => K.priceRiseWhatIf(ctx, i.ingredientId, i.risePct) });
export const saveKitchenProfileAction = defineAction({
  permission: "buyer.kitchen.manage",
  schema: z.object({ targetFoodCostPct: num.nullable(), wasteTargetPct: num.nullable(), costBasis: z.enum(COST_BASES).nullable(), rounding: z.enum(ROUNDINGS).nullable() }),
  handler: async (ctx, i) => done(await K.saveKitchenProfile(ctx, i)),
});

export const logWasteAction = defineAction({
  permission: [...ANY_KITCHEN],
  schema: z.object({
    kind: z.enum(["WASTE", "DONATION"]), reason: z.enum(WASTE_REASONS).nullable(), ingredientId: id.nullable(), recipeId: id.nullable(), lotId: id.nullable(), label: z.string().max(120).nullable(),
    qty: num, unit: z.enum(WASTE_UNITS), note: z.string().max(500).nullable(), recipient: z.string().max(120).nullable(), receiptRef: z.string().max(60).nullable(), at: z.string().max(40).nullable(),
  }),
  handler: async (ctx, i) => done(await K.logWaste(ctx, i)),
});
export const deleteWasteAction = defineAction({ permission: [...ANY_KITCHEN], schema: z.object({ id }), handler: async (ctx, i) => done(await K.deleteWaste(ctx, i.id)) });

// FIRINGI
const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
export const saveKitchenSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), types: flags(KITCHEN_TYPES), parts: flags(KITCHEN_PARTS), targetFoodCostPct: num, costBasis: z.enum(COST_BASES), averageDays: num, rounding: z.enum(ROUNDINGS),
    priceRiseAlertPct: num, wasteTargetPct: num, useFirstDays: num, engineeringDays: num, orderLessMinEntries: num,
  }),
  handler: async (ctx, i) => done(await K.saveKitchenSettings(ctx, i)),
});
export const setKitchenSwitchAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => done(await K.setKitchenSwitch(ctx, i.companyId, i.state)) });
