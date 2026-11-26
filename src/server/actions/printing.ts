"use server";
/** Printing (Services): print suppliers' products and orders; customers order and accept quotes; FIRINGI records payments. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { defineAction } from "./_action";
import { PRINT_DELIVERY, PRINT_KINDS } from "@/lib/printing";
import { LABEL_FORMATS } from "@/lib/shelf-labels";

const P = () => import("@/server/servicing/printing");
const id = z.string().min(1).max(40);
const money = z.coerce.number().min(0).max(100000);
const all = <T,>(v: T) => { revalidatePath("/buy/services/printing"); revalidatePath("/vendor/services/printing"); revalidatePath("/admin/services"); revalidatePath("/buy/catalogue/shelf-labels"); return v; };
const size = z.object({ paper: z.enum(["A4", "ROLL"]), w: z.number(), h: z.number(), top: z.number(), left: z.number(), gapX: z.number(), gapY: z.number() }).partial();

export const savePrintProductAction = defineAction({
  permission: ["vendor.services.manage", "admin.services.manage"],
  schema: z.object({
    id: id.nullable(), kind: z.enum(PRINT_KINDS), name: z.string().trim().min(2, "Name the product.").max(120), description: z.string().trim().max(1000).nullable().optional(),
    labelFormat: z.enum([...LABEL_FORMATS, "CUSTOM"]).nullable().optional(), customSize: size.nullable().optional(),
    unitPriceNet: money, setupNet: money, minQty: z.coerce.number().int().min(1).max(1000000), stepQty: z.coerce.number().int().min(1).max(100000),
    priceOnRequest: z.boolean(), vatRate: z.coerce.number().min(0).max(30), turnaroundDays: z.coerce.number().int().min(0).max(60), delivery: z.array(z.enum(PRINT_DELIVERY)).min(1), active: z.boolean(),
  }),
  handler: async (ctx, { id: pid, ...i }) => { const p = await (await P()).savePrintProduct(ctx, pid, i); return all({ id: p.id }); },
});
export const printStepAction = defineAction({
  permission: ["vendor.services.manage", "vendor.services.visit", "admin.services.manage"],
  schema: z.object({ id, step: z.enum(["ACCEPT", "QUOTE", "PRINTING", "DELIVERED", "REJECT"]), priceNet: money.nullable().optional(), note: z.string().trim().max(500).nullable().optional(), readyBy: z.coerce.date().nullable().optional(), providerInvoiceNo: z.string().trim().max(60).nullable().optional() }),
  handler: async (ctx, { id: jid, ...i }) => { await (await P()).printStep(ctx, jid, i); return all(true); },
});
export const orderPrintAction = defineAction({
  permission: "buyer.services.manage",
  schema: z.object({
    productId: id, qty: z.coerce.number().int().min(1).max(1000000), title: z.string().trim().max(120), notes: z.string().trim().max(2000).nullable().optional(),
    delivery: z.enum(PRINT_DELIVERY), addressId: id.nullable().optional(), wantedBy: z.coerce.date().nullable().optional(),
    artwork: z.array(z.object({ key: z.string().max(200), fileName: z.string().max(200) })).max(10).optional(),
    labelIds: z.array(id).max(2000).optional(), copies: z.coerce.number().int().min(1).max(50).optional(),
    labelFields: z.object({ brand: z.boolean(), origin: z.boolean(), code: z.enum(["BARCODE", "QR", "NONE"]), unitPrice: z.boolean(), shopName: z.boolean(), date: z.boolean() }).optional(),
  }),
  handler: async (ctx, i) => { const j = await (await P()).orderPrint(ctx, i, await getLocale()); return all({ id: j.id, number: j.number }); },
});
export const customerPrintStepAction = defineAction({
  permission: "buyer.services.manage", schema: z.object({ id, step: z.enum(["ACCEPT_QUOTE", "CANCEL"]) }),
  handler: async (ctx, i) => { await (await P()).customerPrintStep(ctx, i.id, i.step); return all(true); },
});
export const markPrintPaidAction = defineAction({
  permission: "admin.finance.manage", schema: z.object({ ids: z.array(id).min(1).max(500) }),
  handler: async (ctx, i) => all({ count: await (await P()).markPrintPaid(ctx, i.ids) }),
});
