"use server";
/** Van sales (Phase 63). Rights are checked again in the service. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { ValidationError } from "@/server/errors";
import * as V from "@/server/vansales/service";

const id = z.string().min(1).max(64);
const METHOD = z.enum(["CASH", "CARD", "MB_WAY", "ON_ACCOUNT"]);
function refresh() {
  revalidatePath("/vendor/van", "layout");
  revalidatePath("/buy/orders/van");
  revalidatePath("/admin/vendors/van-sales");
}

/** The customer's signature drawn on the phone (PNG data URL) as a file for storage. */
function signatureFile(v: string | null | undefined): File | null {
  if (!v) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m) throw new ValidationError("The signature must be a picture.");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 600_000) throw new ValidationError("The signature picture is too large.");
  return new File([buf], "signature.png", { type: "image/png" });
}

// ── manager ─────────────────────────────────────────────────────────────────

export const createLoadAction = defineAction({
  permission: "vendor.vansales.manage",
  schema: z.object({ warehouseId: id, sellerUserId: id, vehicleId: id.nullable().optional(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await V.createLoad(ctx, i); refresh(); return { id: r.id, number: r.number }; },
});

export const addToLoadAction = defineAction({
  permission: "vendor.vansales.manage",
  schema: z.object({ loadId: id, offerId: id, qty: z.number().int().min(1).max(100_000) }),
  handler: async (ctx, i) => { await V.addToLoad(ctx, i.loadId, i.offerId, i.qty); refresh(); return true; },
});

export const removeFromLoadAction = defineAction({
  permission: "vendor.vansales.manage",
  schema: z.object({ loadId: id, offerId: id }),
  handler: async (ctx, i) => { await V.removeFromLoad(ctx, i.loadId, i.offerId); refresh(); return true; },
});

export const loadableProductsAction = defineAction({
  permission: "vendor.vansales.manage",
  schema: z.object({ loadId: id, q: z.string().max(60).nullable().optional() }),
  handler: async (ctx, i) => V.loadableProducts(ctx, i.loadId, i.q),
});

export const startRoundAction = defineAction({
  permission: "vendor.vansales.manage",
  schema: z.object({ loadId: id }),
  handler: async (ctx, i) => { await V.startRound(ctx, i.loadId); refresh(); return true; },
});

export const cancelLoadAction = defineAction({
  permission: "vendor.vansales.manage",
  schema: z.object({ loadId: id }),
  handler: async (ctx, i) => { await V.cancelLoad(ctx, i.loadId); refresh(); return true; },
});

export const closeLoadAction = defineAction({
  permission: ["vendor.vansales.manage", "vendor.vansales.sell"],
  schema: z.object({ loadId: id, counted: z.record(z.string().max(64), z.number().int().min(0).max(1_000_000)), cashCounted: z.number().min(0).max(10_000_000), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { const r = await V.closeLoad(ctx, i.loadId, i); refresh(); return { variance: r.variance, lostUnits: r.lostUnits, lostValue: r.lostValue }; },
});

// ── seller ──────────────────────────────────────────────────────────────────

export const vanCustomersAction = defineAction({
  permission: ["vendor.vansales.sell", "vendor.vansales.manage"],
  schema: z.object({ q: z.string().max(60).nullable().optional() }),
  handler: async (ctx, i) => V.vanCustomers(ctx, i.q),
});

export const vanPricesAction = defineAction({
  permission: ["vendor.vansales.sell", "vendor.vansales.manage"],
  schema: z.object({ buyerCompanyId: id }),
  handler: async (ctx, i) => V.vanPrices(ctx, i.buyerCompanyId),
});

export const sellFromVanAction = defineAction({
  permission: ["vendor.vansales.sell", "vendor.vansales.manage"],
  schema: z.object({
    buyerCompanyId: id, addressId: id, method: METHOD,
    items: z.array(z.object({ offerId: id, qty: z.number().int().min(1).max(100_000) })).min(1).max(100),
    signedBy: z.string().max(120).nullable().optional(), signature: z.string().max(900_000).nullable().optional(),
    empties: z.record(z.string().max(64), z.number().int().min(0).max(10_000)).nullable().optional(),
    clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), note: z.string().max(500).nullable().optional(),
  }),
  handler: async (ctx, i) => { const r = await V.sellFromVan(ctx, { ...i, signature: signatureFile(i.signature) }); refresh(); return r; },
});

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export const saveVanSalesSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), methods: z.object({ CASH: z.boolean(), CARD: z.boolean(), MB_WAY: z.boolean(), ON_ACCOUNT: z.boolean() }),
    maxCashPerSale: z.number().min(0).max(100_000), requireSignature: z.boolean(), allowEmpties: z.boolean(), allowOffline: z.boolean(),
    varianceAlert: z.number().min(0).max(10_000), maxRoundHours: z.number().int().min(1).max(72),
  }),
  handler: async (ctx, i) => { const r = await V.saveVanSalesSettings(ctx, i); refresh(); return r; },
});

export const setVendorVanSalesAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ vendorId: id, on: z.boolean() }),
  handler: async (ctx, i) => { await V.setVendorVanSales(ctx, i.vendorId, i.on); refresh(); return true; },
});

export const searchVanVendorsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({ q: z.string().max(60) }),
  handler: async (ctx, i) => V.searchVendors(ctx, i.q),
});

export const netVanCashAction = defineAction({
  permission: "admin.finance.manage",
  schema: z.object({ vendorId: id }),
  handler: async (ctx, i) => { const r = await V.adminNetNow(ctx, i.vendorId); refresh(); return r; },
});
