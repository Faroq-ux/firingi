/**
 * What a scanned code is (Phase 25). FIRINGI labels carry QR codes:
 *   FIR:B:<batchId>  a lot      FIR:L:<binId>  a shelf      FIR:O:<order number>[:box]  an order / box
 * Anything else is looked up as a product barcode (EAN/GTIN of the packaging or the variant),
 * a shelf code, a lot number or an order number. Phone cameras and USB / Bluetooth scanners
 * (which type the code and press Enter) both end up here.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { requireInventory } from "@/server/inventory/service";
import { batchRows, SEE } from "./bins";

export type Parsed = { kind: "BATCH" | "BIN" | "ORDER"; id: string; box?: number } | { kind: "TEXT"; text: string };

export function parseScan(raw: string): Parsed {
  const code = raw.trim().replace(/[\r\n\t]/g, "");
  const m = /^FIR:([BLO]):([^:]+)(?::(\d+))?$/i.exec(code);
  if (m) {
    const k = m[1].toUpperCase();
    return k === "B" ? { kind: "BATCH", id: m[2] } : k === "L" ? { kind: "BIN", id: m[2] } : { kind: "ORDER", id: m[2], ...(m[3] ? { box: Number(m[3]) } : {}) };
  }
  return { kind: "TEXT", text: code };
}

/** A GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function validGtin(code: string) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export type ScanResult =
  | { kind: "BATCH"; lots: Awaited<ReturnType<typeof batchRows>> }
  | { kind: "PRODUCT"; offerIds: string[]; lots: Awaited<ReturnType<typeof batchRows>> }
  | { kind: "BIN"; bin: { id: string; code: string; zone: string | null; warehouse: string }; lots: Awaited<ReturnType<typeof batchRows>> }
  | { kind: "ORDER"; order: { id: string; number: string; status: string }; box?: number }
  | { kind: "BLOCKED"; lotCode: string | null }
  | { kind: "UNKNOWN"; code: string };

export async function resolveScan(ctx: Ctx, raw: string, locale: string): Promise<ScanResult> {
  requireInventory(ctx, [...SEE]);
  const p = parseScan(raw);
  const me = ctx.company.id;
  if (p.kind === "BATCH") {
    const b = await prisma.stockBatch.findFirst({ where: { id: p.id, offer: { vendorCompanyId: me } }, select: { id: true, blockedAt: true, lotCode: true } });
    if (!b) return { kind: "UNKNOWN", code: raw };
    if (b.blockedAt) return { kind: "BLOCKED", lotCode: b.lotCode };
    return { kind: "BATCH", lots: await batchRows(ctx, { ids: [b.id] }, locale) };
  }
  if (p.kind === "BIN") {
    const bin = await prisma.bin.findFirst({ where: { id: p.id, companyId: me }, include: { address: { select: { label: true } } } });
    if (!bin) return { kind: "UNKNOWN", code: raw };
    return { kind: "BIN", bin: { id: bin.id, code: bin.code, zone: bin.zone, warehouse: bin.address.label }, lots: await batchRows(ctx, { binId: bin.id }, locale) };
  }
  const orderNumber = p.kind === "TEXT" ? p.text : p.id;
  const order = await prisma.order.findFirst({ where: { number: { equals: orderNumber, mode: "insensitive" }, sellerCompanyId: me }, select: { id: true, number: true, status: true } });
  if (order) return { kind: "ORDER", order, ...(p.kind === "ORDER" && p.box ? { box: p.box } : {}) };
  if (p.kind !== "TEXT") return { kind: "UNKNOWN", code: raw };
  const text = p.text;
  if (/^\d{8,14}$/.test(text)) {
    const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: me, OR: [{ packaging: { gtin: text } }, { packaging: { variant: { gtin: text } } }] }, select: { id: true } });
    if (offers.length) return { kind: "PRODUCT", offerIds: offers.map((o) => o.id), lots: (await Promise.all(offers.map((o) => batchRows(ctx, { offerId: o.id }, locale)))).flat() };
  }
  const bin = await prisma.bin.findFirst({ where: { companyId: me, code: text.toUpperCase() }, include: { address: { select: { label: true } } } });
  if (bin) return { kind: "BIN", bin: { id: bin.id, code: bin.code, zone: bin.zone, warehouse: bin.address.label }, lots: await batchRows(ctx, { binId: bin.id }, locale) };
  const lots = await prisma.stockBatch.findMany({ where: { lotCode: { equals: text, mode: "insensitive" }, offer: { vendorCompanyId: me } }, select: { id: true, blockedAt: true, lotCode: true } });
  const live = lots.filter((l) => !l.blockedAt);
  if (live.length) {
    const rows = await batchRows(ctx, { ids: live.map((l) => l.id) }, locale);
    if (rows.length) return { kind: "BATCH", lots: rows };
  }
  if (lots.length) return { kind: "BLOCKED", lotCode: lots[0].lotCode };
  return { kind: "UNKNOWN", code: raw };
}
