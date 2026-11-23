/** Pre-orders (Phase 71): input schemas shared by the actions. */
import { z } from "zod";

export const id = z.string().min(1).max(40);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const money = z.coerce.number().min(0).max(1_000_000);
export const campaignSchema = z.object({
  kind: z.enum(["SEASONAL", "LAUNCH", "SCARCE"]),
  title: z.string().trim().min(3, "Give the pre-order a title.").max(120),
  description: z.string().max(2000).nullable().optional(),
  opensAt: z.string().min(10).max(30), closesAt: z.string().min(10).max(30),
  deliveryDates: z.array(day).min(1, "Add at least one delivery date.").max(24),
  allocation: z.enum(["PRO_RATA", "FIRST_COME", "LOYAL_FIRST"]),
  depositPct: z.coerce.number().min(0).max(100),
  items: z.array(z.object({
    offerId: id, unitNet: money,
    tiers: z.array(z.object({ minTotal: z.coerce.number().int().min(1), unitNet: money })).max(5).optional(),
    minQty: z.coerce.number().int().min(1).max(100000).optional(), maxQty: z.coerce.number().int().min(1).max(100000).nullable().optional(),
    supplyQty: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
  })).min(1, "Add at least one product.").max(50),
});
export const reservationSchema = z.object({
  campaignId: id, addressId: id, deliveryDate: day, note: z.string().max(500).nullable().optional(),
  lines: z.array(z.object({ itemId: id, qty: z.coerce.number().int().min(0).max(100000) })).min(1).max(50),
});
export const lockSchema = z.object({ offerId: id, qty: z.coerce.number().int().min(1, "Choose how many packs.").max(100000), months: z.coerce.number().int().min(1).max(24), note: z.string().max(500).nullable().optional() });
export const decideSchema = z.object({ id, accept: z.boolean(), unitNet: money.nullable().optional(), depositPct: z.coerce.number().min(0).max(100).nullable().optional(), note: z.string().max(500).nullable().optional() });
export const calloffSchema = z.object({ id, qty: z.coerce.number().int().min(1, "Choose how many packs.").max(100000), addressId: id, deliveryDate: day.nullable().optional() });
export const settingsSchema = z.object({
  enabled: z.boolean(), sellers: z.object({ DISTRIBUTOR: z.boolean(), WHOLESALER: z.boolean() }),
  parts: z.object({ campaigns: z.boolean(), priceLocks: z.boolean(), deposits: z.boolean(), ai: z.boolean() }),
  kinds: z.object({ SEASONAL: z.boolean(), LAUNCH: z.boolean(), SCARCE: z.boolean() }),
  approval: z.enum(["ALWAYS", "AUTO"]),
  maxCampaignDays: z.coerce.number(), maxDeliveryDates: z.coerce.number(), maxDepositPct: z.coerce.number(), maxLockMonths: z.coerce.number(),
  lockReviewAbove: z.coerce.number(), orderDaysBefore: z.coerce.number(), confirmDays: z.coerce.number(), lockRemindDays: z.coerce.number(),
  offCountries: z.array(z.string().max(2)).max(40),
});
