/** AI Centre settings schema (Phase 66) — kept out of the "use server" actions file. */
import { z } from "zod";
import { FORECASTS, FUEL_KINDS, REC_AREAS, REPORTS } from "@/lib/ai-centre";

const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
const rate = z.object({ per100: z.number().min(0.1).max(200), price: z.number().min(0).max(50), co2: z.number().min(0).max(10) });
export const aiCentreSettingsSchema = z.object({
  areas: flags(REC_AREAS), forecasts: flags(FORECASTS), reports: flags(REPORTS), fuels: z.object(Object.fromEntries(FUEL_KINDS.map((k) => [k, rate])) as Record<(typeof FUEL_KINDS)[number], typeof rate>),
  defaultFuel: z.enum(FUEL_KINDS), routeMinKm: z.number().min(0.5).max(100), routeMinPct: z.number().min(1).max(80), mergeWithinKm: z.number().min(1).max(200),
  lapseFactor: z.number().min(1.2).max(10), overdueDays: z.number().int().min(1).max(180), weeklyEmail: z.boolean(), claudeSummaries: z.boolean(),
});
export const reportKindSchema = z.enum(REPORTS);
