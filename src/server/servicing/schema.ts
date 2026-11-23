/** Input shapes for the Services actions (Phase 68) — kept out of the "use server" file. */
import { z } from "zod";
import { FREQUENCIES, INVOICED_BY, OIL_LOG_KINDS, SERVICE_UNITS, WINDOWS } from "@/lib/services";

export const id = z.string().min(1).max(40);
const day = z.coerce.date();
const money = z.coerce.number().min(0).max(100000);

export const planSchema = z.object({
  frequency: z.enum(FREQUENCIES), weekday: z.coerce.number().int().min(1).max(7), dayA: z.coerce.number().int().min(1).max(31), dayB: z.coerce.number().int().min(1).max(31),
  timeWindow: z.enum(WINDOWS), addressId: id.nullable().optional(), containers: z.coerce.number().int().min(0).max(50).optional(), containerLitres: z.coerce.number().int().min(0).max(5000).optional(),
  autoRequestWhenFull: z.boolean().optional(), notes: z.string().trim().max(500).nullable().optional(), startsOn: day.nullable().optional(),
});
export const doneSchema = z.object({
  quantity: z.coerce.number().min(0).max(99999).nullable().optional(), containersTaken: z.coerce.number().int().min(0).max(100).nullable().optional(), containersLeft: z.coerce.number().int().min(0).max(100).nullable().optional(),
  signedBy: z.string().trim().max(120).nullable().optional(), docNumber: z.string().trim().max(60).nullable().optional(), providerInvoiceNo: z.string().trim().max(60).nullable().optional(), note: z.string().trim().max(1000).nullable().optional(),
});
export const typeSchema = z.object({
  code: z.string().trim().min(3, "Give the service a code.").max(40), name: z.string().trim().min(2, "Name the service.").max(120), namePt: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(), kind: z.enum(["COLLECTION", "VISIT"]), unit: z.enum(SERVICE_UNITS), isOil: z.boolean(), wasteCode: z.string().trim().max(20).nullable().optional(),
  needsDocument: z.boolean(), frequencies: z.array(z.enum(FREQUENCIES)).min(1, "Allow at least one schedule."),
  feeNet: money, pricePerUnit: money, buybackPerUnit: money, providerPerVisit: money, providerPerUnit: money,
  invoicedBy: z.enum(INVOICED_BY), commissionPct: z.coerce.number().min(0).max(100), commissionPerVisit: money, commissionPerUnit: money,
  countries: z.array(z.string().trim().length(2)).max(40), active: z.boolean(),
});
export const applySchema = z.object({
  serviceTypeId: id, countries: z.array(z.string().trim().length(2)).max(40), licenceNumber: z.string().trim().max(60).nullable().optional(), licenceExpiresAt: day.nullable().optional(), note: z.string().trim().max(500).nullable().optional(),
});
export const fryerSchema = z.object({ name: z.string().trim().min(1, "Name the fryer.").max(60), capacityL: z.coerce.number().min(1).max(500), oilName: z.string().trim().max(80).nullable().optional(), oilCostPerL: z.coerce.number().min(0).max(100).nullable().optional(), active: z.boolean().optional() });
export const logSchema = z.object({ kind: z.enum(OIL_LOG_KINDS), litres: z.coerce.number().min(0).max(500).nullable().optional(), polarPct: z.coerce.number().min(0).max(60).nullable().optional(), note: z.string().trim().max(300).nullable().optional() });
export const settingsSchema = z.object({
  enabled: z.boolean(), audiences: z.object({ customers: z.boolean(), wholesalers: z.boolean() }), providers: z.object({ distributors: z.boolean(), wholesalers: z.boolean(), firingi: z.boolean() }),
  parts: z.object({ scheduled: z.boolean(), onRequest: z.boolean(), oil: z.boolean(), invoicing: z.boolean(), buyback: z.boolean(), documents: z.boolean(), ai: z.boolean() }),
  oil: z.object({ changeDays: z.coerce.number().int().min(1).max(60), warnPolarPct: z.coerce.number().int().min(5).max(40), maxPolarPct: z.coerce.number().int().min(10).max(40), fullPct: z.coerce.number().int().min(30).max(100) }),
  reminderHours: z.coerce.number().int().min(1).max(168), missedAfterHours: z.coerce.number().int().min(1).max(168), daysAhead: z.coerce.number().int().min(7).max(120), requestLeadDays: z.coerce.number().int().min(0).max(14),
});
