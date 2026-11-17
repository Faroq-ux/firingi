/**
 * Installable phone app (Phase 39): settings, the data a phone keeps for offline use (snapshot),
 * carrying out actions done offline exactly once (sync), installs. Docs: docs/app.md.
 */
import "server-only";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { checkOfflineOrder, DEFAULT_APP_SETTINGS, KIND_PORTAL, mergeAppSettings, offlineDecision, OFFLINE_KINDS, type AppPortal, type AppSettings, type OfflineKind, type OfflineLine } from "@/lib/app";

const KEY = "app.settings";
const DAY = 86_400_000;
const isVendor = (ctx: Ctx) => ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
const num = (v: unknown) => (v == null ? null : Number(v));

// ── settings ────────────────────────────────────────────────────────────────

export async function appSettings(): Promise<AppSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeAppSettings(row?.value as Partial<AppSettings> | undefined);
}

export async function saveAppSettings(ctx: Ctx, v: AppSettings) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const n = (x: number, lo: number, hi: number, label: string) => { if (!Number.isFinite(x) || x < lo || x > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}.`); return Math.round(x * 100) / 100; };
  const value: AppSettings = {
    portals: { buy: !!v.portals.buy, vendor: !!v.portals.vendor, driver: !!v.portals.driver, admin: !!v.portals.admin },
    installPrompt: !!v.installPrompt,
    offlineOrders: { mode: v.offlineOrders.mode === "AUTO" ? "AUTO" : "ASK", maxChangePct: n(v.offlineOrders.maxChangePct, 0, 50, "The price change") },
    snapshot: {
      products: Math.round(n(v.snapshot.products, 10, 1000, "Products kept")), orders: Math.round(n(v.snapshot.orders, 1, 100, "Orders kept")),
      invoices: Math.round(n(v.snapshot.invoices, 0, 100, "Invoices kept")), documents: Math.round(n(v.snapshot.documents, 0, 30, "Invoice PDFs kept")),
    },
    refreshMinutes: Math.round(n(v.refreshMinutes, 5, 240, "Refresh")),
  };
  const existing = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (existing) await prisma.setting.update({ where: { id: existing.id }, data: { value } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value } });
  return value;
}

/** May this person use this portal as an app (and offline)? */
export function portalAllowed(ctx: Ctx, portal: AppPortal) {
  switch (portal) {
    case "buy": return isBuyer(ctx) && can(ctx, ["buyer.catalogue.view", "buyer.orders.view", "buyer.orders.place"]);
    case "vendor": return isVendor(ctx);
    case "driver": return !!ctx.driver && can(ctx, "driver.deliveries.view");
    case "admin": return ctx.company.type === "ADMIN";
  }
}

// ── snapshot (what the phone keeps) ─────────────────────────────────────────

export type Snapshot = {
  v: number; at: string; portal: AppPortal; locale: string;
  user: { id: string; name: string }; company: { id: string; name: string; type: string };
  settings: { refreshMinutes: number; mode: "ASK" | "AUTO"; maxChangePct: number; documents: number };
  buy?: Awaited<ReturnType<typeof buyerData>>; driver?: Awaited<ReturnType<typeof driverData>>; vendor?: Awaited<ReturnType<typeof vendorData>>;
};

export async function snapshot(ctx: Ctx, portal: AppPortal, locale: string): Promise<Snapshot> {
  const s = await appSettings();
  if (!s.portals[portal] || !portalAllowed(ctx, portal)) throw new ForbiddenError();
  const base: Snapshot = {
    v: 1, at: new Date().toISOString(), portal, locale,
    user: { id: ctx.user.id, name: ctx.user.name }, company: { id: ctx.company.id, name: ctx.company.tradeName ?? ctx.company.legalName, type: ctx.company.type },
    settings: { refreshMinutes: s.refreshMinutes, mode: s.offlineOrders.mode, maxChangePct: s.offlineOrders.maxChangePct, documents: s.snapshot.documents },
  };
  if (portal === "buy") return { ...base, buy: await buyerData(ctx, s, locale) };
  if (portal === "driver") return { ...base, driver: await driverData(ctx, locale) };
  if (portal === "vendor") return { ...base, vendor: await vendorData(ctx, s, locale) };
  return base;
}

async function buyerData(ctx: Ctx, s: AppSettings, locale: string) {
  const since = new Date(Date.now() - 180 * DAY);
  // The products this buyer usually buys (most often first, with the last quantity), then its order lists
  const usual = await prisma.orderLine.groupBy({
    by: ["offerId"], where: { order: { buyerCompanyId: ctx.company.id, placedAt: { gte: since }, status: { notIn: ["CANCELLED"] } } },
    _count: { _all: true }, orderBy: { _count: { offerId: "desc" } }, take: s.snapshot.products,
  });
  const listed = await prisma.orderListItem.findMany({ where: { list: { companyId: ctx.company.id } }, select: { offerId: true, qty: true }, take: s.snapshot.products });
  let ids = [...new Set([...usual.map((u) => u.offerId), ...listed.map((l) => l.offerId)])].slice(0, s.snapshot.products);
  // A new buyer (little history): also the products most ordered on FIRINGI lately (only those this buyer can see are kept)
  if (ids.length < 40) {
    const popular = await prisma.orderLine.groupBy({ by: ["offerId"], where: { order: { placedAt: { gte: new Date(Date.now() - 90 * DAY) } } }, _count: { _all: true }, orderBy: { _count: { offerId: "desc" } }, take: 120 });
    let more = popular.map((p) => p.offerId);
    if (more.length < 40) more = more.concat((await prisma.vendorOffer.findMany({ where: { status: "ACTIVE" }, select: { id: true }, orderBy: { updatedAt: "desc" }, take: 200 })).map((o) => o.id));
    ids = [...new Set([...ids, ...more])].slice(0, Math.max(s.snapshot.products, ids.length));
  }
  const lastQty = new Map<string, number>();
  if (ids.length) {
    const last = await prisma.orderLine.findMany({ where: { offerId: { in: ids }, order: { buyerCompanyId: ctx.company.id } }, orderBy: { order: { placedAt: "desc" } }, distinct: ["offerId"], select: { offerId: true, qtyOrdered: true } });
    for (const l of last) lastQty.set(l.offerId, l.qtyOrdered);
  }
  for (const l of listed) if (!lastQty.has(l.offerId)) lastQty.set(l.offerId, l.qty);
  const { presentOffers } = await import("@/server/data/catalogue-buyer");
  const offers = ids.length ? await presentOffers(ctx, ids) : [];
  const rank = new Map(ids.map((id, i) => [id, i]));
  const products = offers
    .filter((o) => o.price)
    .sort((a, b) => (rank.get(a.offerId) ?? 0) - (rank.get(b.offerId) ?? 0))
    .map((o) => ({
      offerId: o.offerId, productId: o.productId, name: pickLocalized(o.name, locale), packaging: pickLocalized(o.packaging.name, locale), brand: o.brand ?? null,
      sku: o.sku ?? null, gtin: o.gtin ?? null, unitGtin: o.unitGtin ?? null, supplier: o.vendor.name,
      unitNet: Number(o.price!.unitPriceNet), unitGross: Number(o.price!.unitPriceGross), minQty: o.minOrderQty, step: o.qtyStep, available: o.available, stock: o.stockStatus,
      usualQty: Math.max(o.minOrderQty, lastQty.get(o.offerId) ?? o.minOrderQty),
    }));
  const { orderableAddressWhere, branchScope } = await import("@/server/multisite/branches");
  // same reach as the order and invoice pages: branch staff see their branches only
  const scope = await branchScope(ctx);
  const inScope = scope ? { branchId: { in: scope } } : {};
  const addresses = await prisma.address.findMany({ where: await orderableAddressWhere(ctx), orderBy: [{ isDefault: "desc" }, { label: "asc" }], select: { id: true, label: true, line1: true, cityName: true, postalCode: true } });
  const orders = await prisma.order.findMany({
    where: { buyerCompanyId: ctx.company.id, ...inScope }, orderBy: { placedAt: "desc" }, take: s.snapshot.orders,
    select: { id: true, number: true, status: true, placedAt: true, grandTotal: true, netTotal: true, requestedDeliveryDate: true, seller: { select: { tradeName: true, legalName: true } }, delivery: { select: { status: true, eta: true } }, lines: { select: { productName: true, packagingName: true, qtyOrdered: true, lineNet: true } } },
  });
  const invoices = s.snapshot.invoices && can(ctx, ["buyer.invoices.view", "buyer.payments.view"]) ? await prisma.invoice.findMany({
    where: { recipientCompanyId: ctx.company.id, status: { not: "DRAFT" }, ...(scope ? { order: inScope } : {}) }, orderBy: { issuedAt: "desc" }, take: s.snapshot.invoices,
    select: { id: true, fullNumber: true, docType: true, issuedAt: true, dueAt: true, grossTotal: true },
  }) : [];
  return {
    products, addresses: addresses.map((a) => ({ id: a.id, label: `${a.label} · ${a.line1}, ${a.postalCode ?? ""} ${a.cityName ?? ""}`.trim() })),
    canOrder: can(ctx, "buyer.orders.place"),
    orders: orders.map((o) => ({
      id: o.id, number: o.number, status: o.status, placedAt: o.placedAt.toISOString(), total: Number(o.grandTotal), supplier: o.seller.tradeName ?? o.seller.legalName,
      deliveryDate: o.requestedDeliveryDate?.toISOString() ?? null, eta: o.delivery?.eta?.toISOString() ?? null, delivery: o.delivery?.status ?? null,
      lines: o.lines.map((l) => ({ name: pickLocalized(l.productName, locale), packaging: pickLocalized(l.packagingName, locale), qty: l.qtyOrdered, net: Number(l.lineNet) })),
    })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.fullNumber, kind: i.docType, issuedAt: i.issuedAt?.toISOString() ?? null, dueAt: i.dueAt?.toISOString() ?? null, total: Number(i.grossTotal), pdf: `/api/invoices/${i.id}/pdf` })),
  };
}

async function driverData(ctx: Ctx, locale: string) {
  if (!ctx.driver) throw new ForbiddenError();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const rows = await prisma.delivery.findMany({
    where: { driverId: ctx.driver.id, OR: [{ status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "FAILED"] } }, { status: "DELIVERED", completedAt: { gte: start } }] },
    include: {
      order: { select: { id: true, buyerCompanyId: true, sellerCompanyId: true, number: true, status: true, deliveryAddress: true, buyerNotes: true, buyer: { select: { tradeName: true, legalName: true, phone: true } }, seller: { select: { tradeName: true, legalName: true } }, lines: { select: { productName: true, packagingName: true, qtyOrdered: true } } } },
      stops: { select: { sequence: true, kind: true, routeId: true } },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    take: 80,
  });
  const { FAILURE_REASONS } = await import("@/server/delivery/state");
  // Phase 40: empties the driver can take back at each open stop (what the customer holds + refills on the order)
  const { stopItems } = await import("@/server/returnables/service");
  const empties = new Map<string, Awaited<ReturnType<typeof stopItems>>>();
  for (const d of rows) if (d.status !== "DELIVERED" && d.status !== "FAILED") empties.set(d.id, await stopItems(d.order.buyerCompanyId, d.order.sellerCompanyId, locale, [], d.order.id));
  return {
    canPod: can(ctx, "driver.pod.capture"),
    reasons: [...FAILURE_REASONS],
    stops: rows
      .map((d) => {
        const a = d.order.deliveryAddress as Record<string, string | null>;
        const drop = d.stops.find((s) => s.kind === "DROP") ?? d.stops[0];
        return {
          deliveryId: d.id, number: d.order.number, status: d.status, orderStatus: d.order.status, sequence: drop?.sequence ?? 999,
          customer: d.order.buyer.tradeName ?? d.order.buyer.legalName, phone: a.phone ?? d.order.buyer.phone ?? null, contact: a.contactName ?? null,
          supplier: d.order.seller.tradeName ?? d.order.seller.legalName,
          address: [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
          lat: a.latitude ? Number(a.latitude) : null, lng: a.longitude ? Number(a.longitude) : null,
          note: d.order.buyerNotes ?? d.notes ?? null, scheduledFor: d.scheduledFor?.toISOString() ?? null,
          items: d.order.lines.map((l) => ({ name: pickLocalized(l.productName, locale), packaging: pickLocalized(l.packagingName, locale), qty: l.qtyOrdered })),
          empties: empties.get(d.id) ?? [],
        };
      })
      .sort((x, y) => x.sequence - y.sequence),
  };
}

async function vendorData(ctx: Ctx, s: AppSettings, locale: string) {
  const { pickLists, getPickList } = await import("@/server/warehouse/picking");
  let lists: Awaited<ReturnType<typeof getPickList>>[] = [];
  try {
    const open = (await pickLists(ctx, "OPEN")).slice(0, 10);
    lists = await Promise.all(open.map((p) => getPickList(ctx, p.id, locale)));
  } catch { lists = []; /* pick & pack is off for this supplier, or no permission */ }
  const batchIds = lists.flatMap((p) => p.lines.map((l) => l.batchId)).filter((x): x is string => !!x);
  const orders = can(ctx, ["vendor.orders.view", "vendor.orders.manage"]) ? await prisma.order.findMany({
    where: { sellerCompanyId: ctx.company.id }, orderBy: { placedAt: "desc" }, take: s.snapshot.orders,
    select: { id: true, number: true, status: true, placedAt: true, requestedDeliveryDate: true, buyer: { select: { tradeName: true, legalName: true } }, lines: { select: { productName: true, packagingName: true, qtyOrdered: true } } },
  }) : [];
  return {
    // Lots in each pick list: the phone checks a scanned QR code (FIR:B:<lot>) without the server
    batchIds,
    pickLists: lists.map((p) => ({
      id: p.id, number: p.number, warehouse: p.warehouse, note: p.note,
      orders: p.orders.map((o) => ({ id: o.id, number: o.number, buyer: o.buyer })),
      lines: p.lines.map((l) => ({ id: l.id, orderNumber: l.orderNumber, product: l.product, packaging: l.packaging, sku: l.sku, gtin: l.gtin, batchId: l.batchId, lotCode: l.lotCode, expiresOn: l.expiresOn ? new Date(l.expiresOn).toISOString().slice(0, 10) : null, bin: l.bin, qty: l.qty, pickedQty: l.pickedQty, shortReason: l.shortReason, blocked: l.blocked })),
    })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, placedAt: o.placedAt.toISOString(), deliveryDate: o.requestedDeliveryDate?.toISOString() ?? null, buyer: o.buyer.tradeName ?? o.buyer.legalName, lines: o.lines.map((l) => ({ name: pickLocalized(l.productName, locale), packaging: pickLocalized(l.packagingName, locale), qty: l.qtyOrdered })) })),
  };
}

// ── sync (carry out an offline action once) ─────────────────────────────────

export type SyncInput = { clientId: string; kind: string; portal: string; at?: string | null; data: Record<string, unknown> };
export type SyncResult = { status: "DONE" | "NEEDS_CONFIRM" | "FAILED" | "BUSY"; result?: unknown; error?: string };

export async function syncOp(ctx: Ctx, op: SyncInput): Promise<SyncResult> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(op.clientId)) throw new ValidationError("Bad action id.");
  if (!(OFFLINE_KINDS as readonly string[]).includes(op.kind)) throw new ValidationError("Unknown action.");
  const kind = op.kind as OfflineKind;
  const portal = KIND_PORTAL[kind];
  const s = await appSettings();
  if (!s.portals[portal] || !portalAllowed(ctx, portal)) throw new ForbiddenError();
  const clientAt = op.at && !Number.isNaN(Date.parse(op.at)) ? new Date(op.at) : null;

  // Claim the action (unique per person + id). Done before → the stored answer; being done right now → BUSY.
  let row = await prisma.offlineOp.findUnique({ where: { userId_clientId: { userId: ctx.user.id, clientId: op.clientId } } });
  if (row?.status === "DONE") return { status: "DONE", result: row.result };
  if (row?.status === "PROCESSING" && row.updatedAt.getTime() > Date.now() - 120_000) return { status: "BUSY" };
  if (row && row.kind !== kind) throw new ValidationError("This action id was used for something else.");
  try {
    row = row
      ? await prisma.offlineOp.update({ where: { id: row.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, error: null } })
      : await prisma.offlineOp.create({ data: { userId: ctx.user.id, companyId: ctx.company.id, portal, clientId: op.clientId, kind, clientAt } });
  } catch {
    return { status: "BUSY" }; // the same action arrived twice at the same moment
  }

  let out: SyncResult;
  try {
    out = await run(ctx, kind, op.data ?? {}, s);
  } catch (e) {
    out = { status: "FAILED", error: e instanceof AppError ? e.message : "Something went wrong. Try again later." };
    if (!(e instanceof AppError)) console.error("offline sync", kind, e);
  }
  await prisma.offlineOp.update({ where: { id: row.id }, data: { status: out.status === "BUSY" ? "FAILED" : out.status, result: (out.result ?? undefined) as never, error: out.error ?? null } });
  return out;
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN);

/** A picture taken on the phone (data URL) as a File for the existing upload code. */
function dataUrlFile(v: unknown, name: string): File | null {
  if (typeof v !== "string" || !v.startsWith("data:image/")) return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m) throw new ValidationError("Photos and signatures must be images (JPG, PNG or WEBP).");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 6_000_000) throw new ValidationError("A photo is too large.");
  return new File([buf], `${name}.${m[1].split("/")[1]}`, { type: m[1] });
}

async function run(ctx: Ctx, kind: OfflineKind, d: Record<string, unknown>, s: AppSettings): Promise<SyncResult> {
  switch (kind) {
    case "order.place": return placeOffline(ctx, d, s);
    case "delivery.step": {
      const deliveries = await import("@/server/services/deliveries");
      const id = str(d.deliveryId, 64);
      if (d.step === "PICK_UP") await deliveries.pickUp(ctx, id);
      else if (d.step === "START") await deliveries.startDelivery(ctx, id);
      else throw new ValidationError("Unknown delivery step.");
      return { status: "DONE", result: { deliveryId: id, step: d.step } };
    }
    case "delivery.complete": {
      const deliveries = await import("@/server/services/deliveries");
      const id = str(d.deliveryId, 64);
      const photos = (Array.isArray(d.photos) ? d.photos : []).slice(0, 4).map((p, i) => dataUrlFile(p, `photo-${i}`)).filter((f): f is File => !!f);
      await deliveries.completeDelivery(ctx, id, {
        recipientName: str(d.recipientName, 120), note: str(d.note, 500) || null, signature: dataUrlFile(d.signature, "signature"), photos,
        latitude: typeof d.lat === "number" ? d.lat : null, longitude: typeof d.lng === "number" ? d.lng : null,
        // Phase 40: empties counted at the stop, offline
        empties: d.empties && typeof d.empties === "object" ? Object.fromEntries(Object.entries(d.empties as Record<string, unknown>).slice(0, 30).map(([k, v]) => [k.slice(0, 64), Math.max(0, Math.floor(Number(v) || 0))])) : null,
      });
      return { status: "DONE", result: { deliveryId: id } };
    }
    case "delivery.fail": {
      const deliveries = await import("@/server/services/deliveries");
      const id = str(d.deliveryId, 64);
      await deliveries.failDelivery(ctx, id, {
        reasonCode: str(d.reasonCode, 40), note: str(d.note, 500) || null, photo: dataUrlFile(d.photo, "photo"),
        latitude: typeof d.lat === "number" ? d.lat : null, longitude: typeof d.lng === "number" ? d.lng : null,
      });
      return { status: "DONE", result: { deliveryId: id } };
    }
    case "pick.scan": {
      const { scanPick } = await import("@/server/warehouse/picking");
      const r = await scanPick(ctx, str(d.lineId, 64), str(d.code, 200), Math.max(1, int(d.qty) || 1));
      // A wrong scan changes nothing — reported back so the picker can look again
      return r.outcome === "OK" || r.outcome === "DONE" ? { status: "DONE", result: r } : { status: "FAILED", result: r, error: r.outcome };
    }
    case "pick.confirm": {
      const { confirmPick } = await import("@/server/warehouse/picking");
      await confirmPick(ctx, str(d.lineId, 64), int(d.qty));
      return { status: "DONE", result: { lineId: d.lineId } };
    }
    case "pick.short": {
      const { reportShort } = await import("@/server/warehouse/picking");
      await reportShort(ctx, str(d.lineId, 64), { found: int(d.found), reason: str(d.reason, 200) });
      return { status: "DONE", result: { lineId: d.lineId } };
    }
  }
}

/**
 * An order placed without signal. Today's prices and stock are checked against what the phone
 * showed; the admin's rule decides whether it is placed by itself or the buyer confirms first.
 */
async function placeOffline(ctx: Ctx, d: Record<string, unknown>, s: AppSettings): Promise<SyncResult> {
  const raw = Array.isArray(d.items) ? d.items : [];
  const lines: OfflineLine[] = raw.slice(0, 200).map((x) => {
    const r = x as Record<string, unknown>;
    return { offerId: str(r.offerId, 64), qty: int(r.qty), seenUnitNet: typeof r.seenUnitNet === "number" ? r.seenUnitNet : NaN, name: str(r.name, 200) };
  });
  if (!lines.length || lines.some((l) => !l.offerId || !(l.qty > 0) || !Number.isFinite(l.seenUnitNet))) throw new ValidationError("The order is empty or damaged.");
  const addressId = str(d.addressId, 64);
  if (!addressId) throw new ValidationError("Choose one of your delivery addresses.");
  const { presentOffers } = await import("@/server/data/catalogue-buyer");
  const offers = await presentOffers(ctx, lines.map((l) => l.offerId));
  const check = checkOfflineOrder(lines, offers.map((o) => ({
    offerId: o.offerId, name: pickLocalized(o.name, ctx.user.locale ?? "en"), unitNet: o.price ? Number(o.price.unitPriceNet) : null,
    available: o.available, minQty: o.minOrderQty, step: o.qtyStep,
  })));
  const decision = offlineDecision(check, s.offlineOrders, d.accept === true);
  if (decision === "ASK") return { status: "NEEDS_CONFIRM", result: { changes: check.changes, unavailable: check.unavailable, ok: check.ok, mode: s.offlineOrders.mode, maxChangePct: s.offlineOrders.maxChangePct } };
  if (decision === "NOTHING") return { status: "FAILED", error: "Nothing in this order can be ordered now." };
  const { placeOrder } = await import("@/server/services/orders");
  const note = str(d.note, 500);
  const placed = await placeOrder(ctx, {
    deliveryAddressId: addressId, items: check.ok.map((l) => ({ offerId: l.offerId, qty: l.qty })),
    notes: note || null, requestedDeliveryDate: typeof d.deliveryDate === "string" && d.deliveryDate ? new Date(d.deliveryDate) : null,
    poReference: str(d.poReference, 60) || null,
  });
  return { status: "DONE", result: { number: placed.number, orders: placed.orders, approval: placed.approval ?? null, payFirst: placed.payFirst ?? false, changes: check.changes, left: check.unavailable } };
}

// ── installs ────────────────────────────────────────────────────────────────

export async function recordAppEvent(ctx: Ctx, portal: AppPortal, kind: "INSTALLED" | "OPENED", platform: string | null) {
  if (!portalAllowed(ctx, portal)) return;
  const p = platform && ["android", "ios", "desktop"].includes(platform) ? platform : null;
  const now = new Date();
  const row = await prisma.appInstall.findUnique({ where: { userId_portal: { userId: ctx.user.id, portal } } });
  if (!row) await prisma.appInstall.create({ data: { userId: ctx.user.id, companyId: ctx.company.id, portal, platform: p } });
  else if (kind === "INSTALLED" || row.lastOpenedAt.getTime() < now.getTime() - 3_600_000)
    await prisma.appInstall.update({ where: { id: row.id }, data: { lastOpenedAt: now, opens: { increment: 1 }, ...(p ? { platform: p } : {}) } });
}

/** FIRINGI's overview: installs, offline actions, what needed attention. */
export async function appStats(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const since = new Date(Date.now() - 30 * DAY);
  const week = new Date(Date.now() - 7 * DAY);
  const [installs, active, ops, failed] = await Promise.all([
    prisma.appInstall.groupBy({ by: ["portal"], _count: { _all: true } }),
    prisma.appInstall.groupBy({ by: ["portal"], where: { lastOpenedAt: { gte: week } }, _count: { _all: true } }),
    prisma.offlineOp.groupBy({ by: ["kind", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.offlineOp.findMany({ where: { status: { in: ["FAILED", "NEEDS_CONFIRM"] }, createdAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: 30 }),
  ]);
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(failed.map((f) => f.userId))] } }, select: { id: true, name: true } });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(failed.map((f) => f.companyId))] } }, select: { id: true, tradeName: true, legalName: true } });
  return {
    installs: Object.fromEntries(installs.map((i) => [i.portal, i._count._all])) as Record<string, number>,
    active: Object.fromEntries(active.map((i) => [i.portal, i._count._all])) as Record<string, number>,
    ops: ops.map((o) => ({ kind: o.kind, status: o.status, n: o._count._all })),
    attention: failed.map((f) => ({
      id: f.id, kind: f.kind, status: f.status, error: f.error, at: f.updatedAt, clientAt: f.clientAt, attempts: f.attempts,
      person: people.find((p) => p.id === f.userId)?.name ?? "—", company: (() => { const c = companies.find((x) => x.id === f.companyId); return c ? c.tradeName ?? c.legalName : "—"; })(),
    })),
  };
}

export { DEFAULT_APP_SETTINGS, num };
