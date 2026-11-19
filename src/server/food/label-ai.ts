import "server-only";
/**
 * Phase 44: the AI reads a product's label photo and fills in the food information as a DRAFT the supplier
 * checks and submits (never published directly). One forced tool call (`record_food_info`); the tool input is
 * validated with zod before anything is saved. With no API key: refused — except in development / browser
 * tests (ASSISTANT_SIMULATE=1), where a fixed simulated reading stands in, clearly marked as simulated.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError, ValidationError } from "@/server/errors";
import { readStored } from "@/server/services/storage";
import { aiSettings, aiTransport } from "@/server/ai/assistant";
import { logAi } from "@/server/ai/feed";
import { ALLERGENS, DIETS, NUTRIENTS } from "@/lib/food";
import { foodSettings, saveFoodDraft, type FoodInput } from "./service";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const IMAGE = ["image/jpeg", "image/png", "image/webp"] as const;

const nutrientProps = Object.fromEntries(NUTRIENTS.map((n) => [n, { type: ["number", "null"], description: `${n} per 100 g / 100 ml as printed (energy in kJ / kcal, the rest in grams); null if not printed` }]));
const TOOL = {
  name: "record_food_info",
  description: "Record the food information printed on the product label (EU 1169/2011). Only what is actually printed — never guess.",
  eager_input_streaming: true,
  input_schema: {
    type: "object" as const,
    properties: {
      allergens: {
        type: "object",
        description: "For each of the 14 EU allergens: CONTAINS (in the ingredients, usually in bold), MAY_CONTAIN (a 'may contain / traces' warning), FREE (the label clearly lets you conclude it is absent — e.g. the full ingredient list is visible and it isn't there and there is no traces warning), or null if you can't tell.",
        properties: Object.fromEntries(ALLERGENS.map((a) => [a, { type: ["string", "null"], enum: ["CONTAINS", "MAY_CONTAIN", "FREE", null] }])),
      },
      ingredients: { type: ["string", "null"], description: "The ingredients list as printed, in the label's language; put each allergen between asterisks, e.g. 'Farinha de *trigo*'." },
      ingredientsLanguage: { type: ["string", "null"], description: "ISO 639-1 code of the ingredients text (pt, es, en, …)." },
      nutrition: { type: ["object", "null"], properties: { basis: { type: "string", enum: ["100g", "100ml"] }, ...nutrientProps } },
      diets: { type: "array", items: { type: "string", enum: [...DIETS] }, description: "Only claims printed on the label (logos or text): vegan, halal, organic …" },
      originCountryCode: { type: ["string", "null"], description: "ISO 3166-1 alpha-2 country of origin if printed." },
      storage: { type: ["string", "null"], description: "Storage instructions as printed." },
      afterOpeningDays: { type: ["integer", "null"], description: "Days to use after opening, if printed." },
      unsure: { type: "string", description: "One or two short sentences: what was unreadable or uncertain. Empty if all clear." },
    },
    required: ["allergens", "ingredients", "nutrition", "diets", "unsure"],
  },
};

const Level = z.enum(["CONTAINS", "MAY_CONTAIN", "FREE"]).nullable().optional();
const Num = z.number().nonnegative().nullable().optional();
const Reading = z.object({
  allergens: z.object(Object.fromEntries(ALLERGENS.map((a) => [a, Level])) as Record<(typeof ALLERGENS)[number], typeof Level>).partial(),
  ingredients: z.string().max(5000).nullable(),
  ingredientsLanguage: z.string().regex(/^[a-z]{2}$/).nullable().optional(),
  nutrition: z.object({
    basis: z.enum(["100g", "100ml"]).optional(),
    energyKj: Num, energyKcal: Num, fat: Num, saturates: Num, carbohydrate: Num, sugars: Num, fibre: Num, protein: Num, salt: Num,
  }).nullable(),
  diets: z.array(z.enum(DIETS)),
  originCountryCode: z.string().regex(/^[A-Za-z]{2}$/).nullable().optional(),
  storage: z.string().max(500).nullable().optional(),
  afterOpeningDays: z.number().int().min(1).max(3650).nullable().optional(),
  unsure: z.string().max(600),
});
export type LabelReading = z.infer<typeof Reading>;

const simulating = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";

/** What a simulated reading returns (development / browser tests only). */
const SIMULATED: LabelReading = {
  allergens: { GLUTEN: "CONTAINS", MILK: "MAY_CONTAIN", CRUSTACEANS: "FREE", EGGS: "FREE", FISH: "FREE", PEANUTS: "FREE", SOY: "FREE", NUTS: "FREE", CELERY: "FREE", MUSTARD: "FREE", SESAME: "FREE", SULPHITES: "FREE", LUPIN: "FREE", MOLLUSCS: "FREE" },
  ingredients: "Farinha de *trigo*, água, sal, levedura.", ingredientsLanguage: "pt",
  nutrition: { basis: "100g", energyKj: 1046, energyKcal: 250, fat: 1.2, saturates: 0.3, carbohydrate: 50, sugars: 2, fibre: 3, protein: 8, salt: 1.1 },
  diets: ["VEGAN"], originCountryCode: "PT", storage: "Conservar em local fresco e seco.", afterOpeningDays: null,
  unsure: "Simulated reading — no AI is connected. Check every field against the label.",
};

export async function aiLabelStatus() {
  const s = await foodSettings();
  return { on: s.enabled && s.ai, configured: !!aiTransport() || simulating() };
}

/** Read the label photo of the supplier's working version into a DRAFT (source AI). */
export async function readLabel(ctx: Ctx, productId: string) {
  const status = await aiLabelStatus();
  if (!status.on) throw new AppError("FOOD_OFF", "Reading labels with AI is switched off.");
  const w = await prisma.foodInfo.findFirst({
    where: { productId, status: { in: ["DRAFT", "REJECTED"] }, ...(ctx.company.type === "ADMIN" ? {} : { submittedByCompanyId: ctx.company.id }) },
    orderBy: { version: "desc" }, select: { id: true, labelKey: true, labelMime: true, product: { select: { name: true } } },
  });
  if (!w?.labelKey) throw new ValidationError("Upload a photo of the label first.");
  if (!(IMAGE as readonly string[]).includes(w.labelMime ?? "")) throw new ValidationError("The AI reads photos (JPG, PNG, WEBP), not PDFs.");

  let reading: LabelReading;
  const transport = aiTransport();
  if (!transport) {
    if (!simulating()) throw new AppError("AI_NOT_CONFIGURED", "No AI is connected — ask FIRINGI to set it up, or fill the fields in yourself.");
    reading = SIMULATED;
  } else {
    const settings = await aiSettings();
    const buf = await readStored(w.labelKey);
    const params: Params = {
      model: settings.model, max_tokens: 4096,
      system: "You read food product labels for a B2B food wholesaler in the EU and record exactly what is printed (EU 1169/2011). Never invent ingredients, values or claims. If something is unreadable, leave it null and say so in `unsure`.",
      tools: [TOOL as unknown as Anthropic.Beta.Messages.BetaTool],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: w.labelMime as (typeof IMAGE)[number], data: buf.toString("base64") } },
        { type: "text", text: "Record the food information on this label." },
      ] }],
    };
    const res = await transport(params);
    if (res.stop_reason === "max_tokens" || res.stop_reason === "refusal") throw new AppError("AI_LABEL_FAILED", "The AI couldn't read this label — try a sharper photo, or fill the fields in yourself.");
    const call = res.content.find((b) => b.type === "tool_use" && b.name === TOOL.name) as { input: unknown } | undefined;
    const parsed = Reading.safeParse(call?.input);
    if (!parsed.success) throw new AppError("AI_LABEL_FAILED", "The AI's reading was incomplete — try again, or fill the fields in yourself.");
    reading = parsed.data;
  }

  const lang = reading.ingredientsLanguage ?? "pt";
  const input: FoodInput = {
    allergens: Object.fromEntries(Object.entries(reading.allergens).map(([k, v]) => [k, v ?? null])),
    ingredients: reading.ingredients ? { [lang]: reading.ingredients } : {},
    nutrition: reading.nutrition ? { basis: reading.nutrition.basis ?? "100g", ...Object.fromEntries(NUTRIENTS.map((n) => [n, reading.nutrition![n] ?? null])) } : null,
    diets: reading.diets, originCountryCode: reading.originCountryCode ?? null, storage: reading.storage ? { [lang]: reading.storage } : {}, afterOpeningDays: reading.afterOpeningDays ?? null,
  };
  const id = await saveFoodDraft(ctx, productId, input, "AI", reading.unsure || null);
  await logAi({ kind: "LABEL", ctx, summary: `Label read for ${(w.product.name as Record<string, string>).en ?? "a product"}`, detail: { productId, unsure: reading.unsure, simulated: !transport } }).catch(() => null);
  return { id, unsure: reading.unsure, simulated: !transport };
}
