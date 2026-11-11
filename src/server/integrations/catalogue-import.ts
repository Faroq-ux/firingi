/**
 * Supplier catalogue import (Excel / CSV upload, scheduled URL feed, API bulk): read the file,
 * map its columns to FIRINGI fields (guessed from the headers in PT / EN / ES, saved per profile),
 * compare every row with what FIRINGI has (new offer / price / stock / settings / not found /
 * error), show that preview, and apply it with the supplier's own permissions.
 *
 * Rows are matched to the supplier's offers by its own code (vendor_sku), else by barcode (the
 * packaging's or, for single units, the product's GTIN). Products FIRINGI doesn't have yet are
 * reported as "not found" — the supplier proposes them in Products (FIRINGI approves new products).
 * Prices go to the supplier's base price list; stock to the named (or first) warehouse.
 * A price change of more than 50 % is a "big change": it needs confirming (uploads) and holds a
 * scheduled feed for review instead of applying it.
 */
import "server-only";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { createOffer, setOwnOfferActive, setStock, updateOffer } from "@/server/services/vendor-catalogue";
import { ensureBaseList, setPrice } from "@/server/services/pricing";

export const FIELDS = ["vendor_sku", "gtin", "price", "stock", "warehouse", "min_qty", "qty_step", "lead_days", "active", "name"] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<string, Field | "">;
export const MAX_ROWS = 5000;
export const MAX_BYTES = 10 * 1024 * 1024;
const BIG_CHANGE = 0.5;

// ── reading files ───────────────────────────────────────────────────────────

export type Sheet = { headers: string[]; rows: string[][] };

/** RFC 4180 CSV with ; , tab or | as separator (detected), quotes, BOM. */
export function parseCsv(text: string): Sheet {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", ",", "\t", "|"].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  const [headers = [], ...rows] = out;
  return { headers: headers.map((h) => h.trim()), rows };
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};

export async function parseXlsx(buf: Buffer): Promise<Sheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError("The workbook has no sheets.");
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    for (let c = 1; c <= r.cellCount; c++) vals.push(cellText(r.getCell(c).value).trim());
    if (vals.some((v) => v !== "")) rows.push(vals);
  });
  const [headers = [], ...rest] = rows;
  return { headers, rows: rest };
}

export async function parseFile(buf: Buffer, fileName: string): Promise<Sheet> {
  if (buf.length > MAX_BYTES) throw new ValidationError("The file is larger than 10 MB.");
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const sheet = isZip || /\.xlsx$/i.test(fileName) ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
  if (!sheet.headers.length) throw new ValidationError("The file is empty.");
  if (sheet.rows.length > MAX_ROWS) throw new ValidationError(`At most ${MAX_ROWS} rows per file.`);
  return sheet;
}

// ── mapping ────────────────────────────────────────────────────────────────

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const SYNONYMS: Record<Field, string[]> = {
  vendor_sku: ["vendor sku", "sku", "ref", "referencia", "reference", "codigo", "cod", "code", "item code", "artigo", "codigo artigo", "product code", "codigo producto", "articulo", "your code", "supplier code"],
  gtin: ["gtin", "ean", "ean13", "barcode", "bar code", "codigo de barras", "codigo barras", "cod barras", "upc"],
  price: ["price", "preco", "precio", "pvp", "net price", "preco liquido", "preco sem iva", "precio neto", "unit price", "preco unitario", "cost", "tarifa"],
  stock: ["stock", "qty", "quantity", "quantidade", "cantidad", "existencias", "disponivel", "available", "inventario", "inventory", "on hand"],
  warehouse: ["warehouse", "armazem", "almacen", "location", "local", "deposito"],
  min_qty: ["min qty", "minimum", "minimo", "quantidade minima", "cantidad minima", "moq", "min order"],
  qty_step: ["step", "qty step", "multiplo", "multiple", "multiplo de venda", "pack step"],
  lead_days: ["lead days", "lead time", "prazo", "prazo entrega", "plazo", "dias entrega", "delivery days"],
  active: ["active", "ativo", "activo", "status", "estado", "available for sale", "disponivel para venda"],
  name: ["name", "nome", "nombre", "descricao", "description", "descripcion", "produto", "product", "designacao"],
};

/** Best guess of which FIRINGI field each column holds (each field used once). */
export function guessMapping(headers: string[]): Mapping {
  const used = new Set<Field>();
  const out: Mapping = {};
  for (const h of headers) {
    const f = fold(h);
    const hit = (Object.keys(SYNONYMS) as Field[]).find((k) => !used.has(k) && (SYNONYMS[k].includes(f) || f === k.replace("_", " ")));
    const loose = hit ?? (Object.keys(SYNONYMS) as Field[]).find((k) => !used.has(k) && SYNONYMS[k].some((s) => s.length > 3 && f.includes(s)));
    out[h] = loose ?? "";
    if (loose) used.add(loose);
  }
  return out;
}

// ── normalising ────────────────────────────────────────────────────────────

/** "1.234,56" / "1,234.56" / "12,5" / "€ 3,20" → "1234.56" etc. (null when not a number). */
export function parseNumber(raw: string): string | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  // One comma is a decimal comma (European files: "0,350" is 0.35); several are thousands separators.
  else if (lastComma >= 0) s = s.match(/,/g)!.length === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  try { const d = new Decimal(s); return d.isFinite() ? d.toString() : null; } catch { return null; }
}
const parseBool = (raw: string): boolean | null => {
  const f = fold(raw);
  if (["1", "yes", "y", "sim", "si", "s", "true", "ativo", "activo", "active", "on"].includes(f)) return true;
  if (["0", "no", "n", "nao", "false", "inativo", "inactivo", "inactive", "off", "paused", "pausado"].includes(f)) return false;
  return null;
};

export type NormRow = {
  line: number; vendorSku: string | null; gtin: string | null; price: string | null; stock: number | null; warehouse: string | null;
  minQty: number | null; qtyStep: number | null; leadDays: number | null; active: boolean | null; name: string | null; errors: string[];
};

export function normalise(sheet: Sheet, mapping: Mapping): NormRow[] {
  const idx = (f: Field) => sheet.headers.findIndex((h) => mapping[h] === f);
  const col = Object.fromEntries(FIELDS.map((f) => [f, idx(f)])) as Record<Field, number>;
  if (col.vendor_sku < 0 && col.gtin < 0) throw new ValidationError("Map a column to your product code or to the barcode — that's how rows are matched.");
  if (col.price < 0 && col.stock < 0 && col.active < 0 && col.min_qty < 0 && col.qty_step < 0 && col.lead_days < 0) throw new ValidationError("Map at least one column to update (price, stock, …).");
  return sheet.rows.map((r, i) => {
    const get = (f: Field) => (col[f] >= 0 ? (r[col[f]] ?? "").trim() : "");
    const errors: string[] = [];
    const int = (f: Field, label: string, min: number) => {
      const v = get(f);
      if (!v) return null;
      const n = parseNumber(v);
      if (n === null || !Number.isInteger(Number(n)) || Number(n) < min) { errors.push(`${label} "${v}" isn't a whole number ≥ ${min}`); return null; }
      return Number(n);
    };
    const priceRaw = get("price");
    const price = priceRaw ? parseNumber(priceRaw) : null;
    if (priceRaw && (price === null || new Decimal(price).lte(0))) errors.push(`Price "${priceRaw}" isn't a positive number`);
    const gtin = get("gtin").replace(/\s+/g, "") || null;
    if (gtin && !/^\d{8,14}$/.test(gtin)) errors.push(`Barcode "${gtin}" should have 8–14 digits`);
    const activeRaw = get("active");
    const active = activeRaw ? parseBool(activeRaw) : null;
    if (activeRaw && active === null) errors.push(`Active "${activeRaw}" should be yes / no`);
    const row: NormRow = {
      line: i + 2, vendorSku: get("vendor_sku") || null, gtin, price: price && new Decimal(price).gt(0) ? new Decimal(price).toFixed(4) : null,
      stock: int("stock", "Stock", 0), warehouse: get("warehouse") || null, minQty: int("min_qty", "Minimum", 1), qtyStep: int("qty_step", "Step", 1),
      leadDays: int("lead_days", "Lead time", 0), active, name: get("name") || null, errors,
    };
    if (!row.vendorSku && !row.gtin) errors.push("No product code or barcode");
    return row;
  });
}

// ── comparing ──────────────────────────────────────────────────────────────

export type RowResult = NormRow & {
  status: "NEW_OFFER" | "UPDATE" | "UNCHANGED" | "NOT_FOUND" | "ERROR";
  offerId: string | null; packagingUnitId: string | null; product: string | null; addressId: string | null;
  before: { price: string | null; stock: number | null; minQty: number; qtyStep: number; leadDays: number; active: boolean } | null;
  changes: string[]; big: boolean;
};

function requireImporter(ctx: Ctx) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED") throw new ForbiddenError();
  if (!can(ctx, ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"])) throw new ForbiddenError();
}

const nameOf = (n: unknown) => { const o = (n ?? {}) as Record<string, string>; return o.pt ?? o.en ?? Object.values(o)[0] ?? "?"; };

export async function compareRows(ctx: Ctx, rows: NormRow[]): Promise<RowResult[]> {
  requireImporter(ctx);
  const me = ctx.company.id;
  const [offers, addresses, base] = await Promise.all([
    prisma.vendorOffer.findMany({
      where: { vendorCompanyId: me },
      include: { packaging: { include: { variant: { include: { product: { select: { name: true } } } } } }, stockLevels: true, prices: { where: { minQty: 1, priceList: { scope: "BASE" } }, select: { unitPriceNet: true } } },
    }),
    prisma.address.findMany({ where: { companyId: me, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    prisma.priceList.findFirst({ where: { vendorCompanyId: me, scope: "BASE", countryId: ctx.company.countryId } }),
  ]);
  void base;
  // A supplier may use one code for several pack sizes — then the barcode decides.
  const bySku = new Map<string, typeof offers>();
  for (const o of offers) if (o.vendorSku) bySku.set(o.vendorSku.toLowerCase(), [...(bySku.get(o.vendorSku.toLowerCase()) ?? []), o]);
  const byPack = new Map(offers.map((o) => [o.packagingUnitId, o]));
  const gtins = [...new Set(rows.map((r) => r.gtin).filter((g): g is string => !!g))];
  const packs = gtins.length ? await prisma.packagingUnit.findMany({
    where: { isActive: true, variant: { isActive: true, product: { status: "APPROVED" } }, OR: [{ gtin: { in: gtins } }, { unitsPerPack: 1, variant: { gtin: { in: gtins } } }] },
    include: { variant: { include: { product: { select: { name: true } } } } },
  }) : [];
  const packByGtin = new Map<string, (typeof packs)[number]>();
  for (const p of packs) { if (p.gtin) packByGtin.set(p.gtin, p); if (p.unitsPerPack === 1 && p.variant.gtin && !packByGtin.has(p.variant.gtin)) packByGtin.set(p.variant.gtin, p); }
  addresses.sort((x, y) => (x.kind === "WAREHOUSE" ? 0 : 1) - (y.kind === "WAREHOUSE" ? 0 : 1)); // no warehouse column → the (first) warehouse
  const addressFor = (w: string | null) => (w ? addresses.find((a) => fold(a.label ?? "") === fold(w) || fold(`${a.line1}`) === fold(w)) : addresses[0]) ?? null;

  return rows.map((r) => {
    const base: RowResult = { ...r, status: "ERROR", offerId: null, packagingUnitId: null, product: null, addressId: null, before: null, changes: [], big: false };
    if (r.errors.length) return base;
    let pack = r.gtin ? packByGtin.get(r.gtin) : undefined;
    const skuOffers = r.vendorSku ? bySku.get(r.vendorSku.toLowerCase()) ?? [] : [];
    let offer = skuOffers.length === 1 ? skuOffers[0] : skuOffers.length > 1 ? skuOffers.find((o) => o.packagingUnitId === pack?.id) : undefined;
    if (!offer && skuOffers.length > 1) return { ...base, errors: [`Code "${r.vendorSku}" is used on ${skuOffers.length} pack sizes — add the barcode column to tell them apart`] };
    if (!offer && pack) offer = byPack.get(pack.id);
    const addr = r.stock !== null ? addressFor(r.warehouse) : null;
    if (r.stock !== null && !addr) return { ...base, errors: [r.warehouse ? `No warehouse called "${r.warehouse}"` : "Add a warehouse address first"] };
    if (!offer && !pack) return { ...base, status: "NOT_FOUND" };
    if (!offer) {
      const changes = ["new offer", ...(r.price ? [`price ${r.price}`] : []), ...(r.stock !== null ? [`stock ${r.stock}`] : [])];
      return { ...base, status: "NEW_OFFER", packagingUnitId: pack!.id, product: `${nameOf(pack!.variant.product.name)} · ${nameOf(pack!.name)}`, addressId: addr?.id ?? null, changes };
    }
    pack = undefined;
    const price = offer.prices[0]?.unitPriceNet ? new Decimal(offer.prices[0].unitPriceNet.toString()).toFixed(4) : null;
    const stock = addr ? (offer.stockLevels.find((s) => s.addressId === addr.id)?.onHand ?? 0) : null;
    const before = { price, stock, minQty: offer.minOrderQty, qtyStep: offer.qtyStep, leadDays: offer.leadTimeDays, active: offer.status === "ACTIVE" };
    const changes: string[] = [];
    let big = false;
    if (r.price && r.price !== price) {
      changes.push(`price ${price ? new Decimal(price).toFixed(2) : "—"} → ${new Decimal(r.price).toFixed(2)}`);
      if (price && new Decimal(r.price).minus(price).abs().div(price).gt(BIG_CHANGE)) big = true;
    }
    if (r.stock !== null && r.stock !== stock) changes.push(`stock ${stock ?? 0} → ${r.stock}`);
    if (r.minQty !== null && r.minQty !== before.minQty) changes.push(`minimum ${before.minQty} → ${r.minQty}`);
    if (r.qtyStep !== null && r.qtyStep !== before.qtyStep) changes.push(`step ${before.qtyStep} → ${r.qtyStep}`);
    if (r.leadDays !== null && r.leadDays !== before.leadDays) changes.push(`lead time ${before.leadDays} → ${r.leadDays}`);
    if (r.active !== null && r.active !== before.active && (offer.status === "ACTIVE" || offer.status === "PAUSED")) changes.push(r.active ? "resume" : "pause");
    return { ...base, status: changes.length ? "UPDATE" : "UNCHANGED", offerId: offer.id, packagingUnitId: offer.packagingUnitId, product: `${nameOf(offer.packaging.variant.product.name)} · ${nameOf(offer.packaging.name)}`, addressId: addr?.id ?? null, before, changes, big };
  });
}

export function summarise(rows: RowResult[]) {
  const count = (s: RowResult["status"]) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length, newOffers: count("NEW_OFFER"), updates: count("UPDATE"), unchanged: count("UNCHANGED"), notFound: count("NOT_FOUND"), errors: count("ERROR"),
    priceChanges: rows.filter((r) => r.changes.some((c) => c.startsWith("price"))).length, stockChanges: rows.filter((r) => r.changes.some((c) => c.startsWith("stock"))).length,
    bigChanges: rows.filter((r) => r.big).length,
  };
}
export type Summary = ReturnType<typeof summarise>;

// ── runs ───────────────────────────────────────────────────────────────────

/** Read + compare → a PREVIEW run (nothing changes yet). */
export async function previewImport(ctx: Ctx, input: { sheet: Sheet; mapping: Mapping; source: "UPLOAD" | "URL" | "API"; fileName?: string | null; profileId?: string | null }) {
  requireImporter(ctx);
  const rows = await compareRows(ctx, normalise(input.sheet, input.mapping));
  const summary = summarise(rows);
  return prisma.importRun.create({
    data: { companyId: ctx.company.id, profileId: input.profileId ?? null, source: input.source, fileName: input.fileName ?? null, rows: rows as unknown as Prisma.InputJsonValue, summary, byUserId: ctx.user.id },
  });
}

/** Apply a preview. Big price changes need `confirmBig`. Each row is applied on its own (one bad row doesn't stop the rest). */
export async function applyImport(ctx: Ctx, runId: string, opts: { confirmBig?: boolean } = {}) {
  requireImporter(ctx);
  const run = await prisma.importRun.findFirst({ where: { id: runId, companyId: ctx.company.id } });
  if (!run) throw new NotFoundError("Import");
  if (run.status !== "PREVIEW") throw new AppError("ALREADY_APPLIED", "This import was already applied or cancelled.", 409);
  if (Date.now() - run.createdAt.getTime() > 24 * 3600_000) throw new AppError("STALE", "This preview is older than a day — upload the file again.", 409);
  const rows = run.rows as unknown as RowResult[];
  const summary = run.summary as unknown as Summary;
  if (summary.bigChanges && !opts.confirmBig) throw new AppError("BIG_CHANGES", `${summary.bigChanges} prices change by more than 50 %. Check them and confirm.`, 409);
  // Claim the run so a double click / two tabs can't apply it twice.
  const claimed = await prisma.importRun.updateMany({ where: { id: run.id, status: "PREVIEW" }, data: { status: "APPLIED", appliedAt: new Date() } });
  if (!claimed.count) throw new AppError("ALREADY_APPLIED", "This import was already applied.", 409);
  const base = rows.some((r) => r.price && (r.status === "NEW_OFFER" || r.status === "UPDATE")) ? await ensureBaseList(ctx) : null;
  const result = { applied: 0, failed: 0, failures: [] as { line: number; error: string }[] };
  for (const r of rows) {
    if (r.status !== "NEW_OFFER" && r.status !== "UPDATE") continue;
    try {
      let offerId = r.offerId;
      if (r.status === "NEW_OFFER") {
        const o = await createOffer(ctx, r.packagingUnitId!, { vendorSku: r.vendorSku, minOrderQty: r.minQty ?? 1, qtyStep: r.qtyStep ?? 1, leadTimeDays: r.leadDays ?? 1 });
        offerId = o.id;
      } else if (r.before && ((r.minQty !== null && r.minQty !== r.before.minQty) || (r.qtyStep !== null && r.qtyStep !== r.before.qtyStep) || (r.leadDays !== null && r.leadDays !== r.before.leadDays))) {
        await updateOffer(ctx, offerId!, { vendorSku: r.vendorSku, minOrderQty: r.minQty ?? r.before.minQty, qtyStep: r.qtyStep ?? r.before.qtyStep, leadTimeDays: r.leadDays ?? r.before.leadDays });
      }
      if (r.price && base && (r.status === "NEW_OFFER" || r.price !== r.before?.price)) await setPrice(ctx, base.id, offerId!, 1, r.price);
      if (r.stock !== null && r.addressId && (r.status === "NEW_OFFER" || r.stock !== r.before?.stock)) await setStock(ctx, offerId!, r.addressId, r.stock, `Import ${run.fileName ?? run.source.toLowerCase()}`);
      if (r.status === "UPDATE" && r.active !== null && r.before && r.active !== r.before.active) await setOwnOfferActive(ctx, offerId!, r.active);
      result.applied++;
    } catch (e) {
      result.failed++;
      result.failures.push({ line: r.line, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await prisma.importRun.update({ where: { id: run.id }, data: { summary: { ...summary, ...result } as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "catalogue.import_applied", entityType: "ImportRun", entityId: run.id, after: { source: run.source, fileName: run.fileName, ...result } });
  return result;
}

export async function cancelImport(ctx: Ctx, runId: string) {
  requireImporter(ctx);
  const r = await prisma.importRun.updateMany({ where: { id: runId, companyId: ctx.company.id, status: "PREVIEW" }, data: { status: "CANCELLED" } });
  if (!r.count) throw new NotFoundError("Import");
}

export async function importRuns(ctx: Ctx, take = 20) {
  requireImporter(ctx);
  return prisma.importRun.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take, select: { id: true, source: true, fileName: true, status: true, summary: true, heldReason: true, error: true, createdAt: true, appliedAt: true, profileId: true } });
}

export async function importRun(ctx: Ctx, id: string) {
  requireImporter(ctx);
  const r = await prisma.importRun.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!r) throw new NotFoundError("Import");
  return { ...r, rows: r.rows as unknown as RowResult[], summary: r.summary as unknown as Summary & { applied?: number; failed?: number; failures?: { line: number; error: string }[] } };
}

/** A template to download: the columns FIRINGI understands, with the supplier's current offers filled in. */
export async function templateRows(ctx: Ctx) {
  requireImporter(ctx);
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] } },
    include: { packaging: { include: { variant: { include: { product: { select: { name: true } } } } } }, stockLevels: { include: { address: { select: { label: true } } } }, prices: { where: { minQty: 1, priceList: { scope: "BASE" } }, select: { unitPriceNet: true } } },
    orderBy: { createdAt: "asc" },
  });
  const header = ["vendor_sku", "gtin", "name", "price", "stock", "warehouse", "min_qty", "qty_step", "lead_days", "active"];
  const rows = offers.map((o) => [
    o.vendorSku ?? "", o.packaging.gtin ?? (o.packaging.unitsPerPack === 1 ? (o.packaging.variant.gtin ?? "") : ""), `${nameOf(o.packaging.variant.product.name)} · ${nameOf(o.packaging.name)}`,
    o.prices[0] ? new Decimal(o.prices[0].unitPriceNet.toString()).toFixed(2) : "", String(o.stockLevels[0]?.onHand ?? ""), o.stockLevels[0]?.address.label ?? "",
    String(o.minOrderQty), String(o.qtyStep), String(o.leadTimeDays), o.status === "ACTIVE" ? "yes" : o.status === "PAUSED" ? "no" : "",
  ]);
  return { header, rows };
}
