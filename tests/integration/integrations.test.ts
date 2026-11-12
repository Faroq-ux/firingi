/**
 * Phase 21: supplier integrations.
 *  • Catalogue import: CSV (European numbers, quotes, BOM) and Excel are read; columns are guessed
 *    from PT / EN / ES headers; a preview shows what would change (nothing changes yet); applying
 *    updates price, stock, minimum, lead time; codes shared by several pack sizes are told apart by
 *    barcode; a price changing by more than 50 % needs a confirmation; a preview is applied once.
 *  • Scheduled feeds (served by a local test server): applied when sane, held when not (and the
 *    supplier is told), failures recorded and told once.
 *  • URL guard: private / loopback / link-local addresses are refused.
 *  • Webhooks: events written with the order (outbox), delivered signed, retried with back-off,
 *    switched off after 20 failures in a row; a test "ping".
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { applyImport, guessMapping, importRun, parseCsv, parseFile, parseNumber, previewImport, type Mapping } from "@/server/integrations/catalogue-import";
import { assertPublicUrl, isPrivateAddress, runFeed, saveProfile, deleteProfile } from "@/server/integrations/feeds";
import { createEndpoint, deleteEndpoint, emitWebhook, eventsFor, listEndpoints, processWebhooks, sendTest, signPayload } from "@/server/integrations/webhooks";
import { addToCart, clearCart } from "@/server/services/cart";
import { confirmOrder, placeOrder, changeOrderStatus } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { ctxFor } from "../helpers";

const LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test";

// ── a tiny local server playing the supplier's feed and the companies' webhook receivers ──
type Hit = { path: string; headers: Record<string, string | string[] | undefined>; body: string };
let server: Server, base = "";
const hits: Hit[] = [];
const routes = new Map<string, { status: number; body: string | Buffer; type?: string }>();
beforeAll(async () => {
  process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = "1";
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", headers: req.headers, body });
      const r = routes.get(req.url ?? "") ?? { status: 404, body: "not found" };
      res.writeHead(r.status, { "content-type": r.type ?? "text/plain" });
      res.end(r.body);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS;
  await new Promise<void>((ok) => server.close(() => ok()));
});

// ── helpers on Lisboa Central's catalogue ──
async function offer(sku: string, units: number) {
  const lx = await ctxFor(LX);
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: sku, packaging: { unitsPerPack: units } }, include: { packaging: true } });
}
async function basePrice(offerId: string) {
  const p = await prisma.priceListItem.findFirst({ where: { offerId, minQty: 1, priceList: { scope: "BASE" } } });
  return p ? Number(p.unitPriceNet) : null;
}
async function warehouse() {
  const lx = await ctxFor(LX);
  return prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE" } });
}
async function onHand(offerId: string) {
  return (await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: (await warehouse()).id } } }))?.onHand ?? 0;
}
const fmt = (n: number) => n.toFixed(2).replace(".", ","); // the way a Portuguese file writes prices

describe("reading files", () => {
  it("reads European CSV: ; separator, decimal comma, quotes, BOM", () => {
    const s = parseCsv("﻿Referência;Descrição;Preço;Stock\r\nGRO-1;\"Água; 1,5 L\";\"1.234,50\";12\nGRO-2;Arroz;0,350;\n\n");
    expect(s.headers).toEqual(["Referência", "Descrição", "Preço", "Stock"]);
    expect(s.rows).toEqual([["GRO-1", "Água; 1,5 L", "1.234,50", "12"], ["GRO-2", "Arroz", "0,350", ""]]);
    expect(parseCsv("sku,price\nA,\"say \"\"hi\"\"\"\n").rows[0]).toEqual(["A", 'say "hi"']);
  });

  it("reads numbers the way people write them", () => {
    expect(parseNumber("1.234,56")).toBe("1234.56");
    expect(parseNumber("1,234.56")).toBe("1234.56");
    expect(parseNumber("0,350")).toBe("0.35");
    expect(parseNumber("€ 3,20")).toBe("3.2");
    expect(parseNumber("12")).toBe("12");
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("-")).toBeNull();
  });

  it("guesses columns from Portuguese, English and Spanish headers", () => {
    expect(guessMapping(["Referência", "EAN", "Preço s/ IVA", "Quantidade", "Armazém", "Nome"])).toEqual({
      Referência: "vendor_sku", EAN: "gtin", "Preço s/ IVA": "price", Quantidade: "stock", Armazém: "warehouse", Nome: "name",
    });
    expect(guessMapping(["SKU", "Barcode", "Price", "Stock", "MOQ", "Lead time"])).toMatchObject({ SKU: "vendor_sku", Barcode: "gtin", Price: "price", Stock: "stock", MOQ: "min_qty", "Lead time": "lead_days" });
    expect(guessMapping(["Código", "Precio", "Existencias"])).toEqual({ Código: "vendor_sku", Precio: "price", Existencias: "stock" });
    expect(guessMapping(["Colour"])).toEqual({ Colour: "" });
  });

  it("reads Excel (first sheet)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Stock");
    ws.addRow(["SKU", "Price", "Stock"]);
    ws.addRow(["GRO-LUSO15", 2.45, 40]);
    ws.addRow([]);
    ws.addRow(["GRO-ARROZ1", { formula: "1+1", result: 2 }, 7]);
    const s = await parseFile(Buffer.from(await wb.xlsx.writeBuffer()), "x.bin");
    expect(s.headers).toEqual(["SKU", "Price", "Stock"]);
    expect(s.rows).toEqual([["GRO-LUSO15", "2.45", "40"], ["GRO-ARROZ1", "2", "7"]]);
  });
});

describe("catalogue import", () => {
  let restore: { luso: number; lusoStock: number; arroz: number; colaCase: number } | null = null;
  beforeAll(async () => {
    const luso = await offer("GRO-LUSO15", 6), arroz = await offer("GRO-ARROZ1", 10), cola = await offer("GRO-COLA33", 24);
    restore = { luso: (await basePrice(luso.id))!, lusoStock: await onHand(luso.id), arroz: (await basePrice(arroz.id))!, colaCase: (await basePrice(cola.id))! };
  });
  afterAll(async () => {
    if (!restore) return;
    const lx = await ctxFor(LX);
    const csv = `sku;ean;price;stock\nGRO-LUSO15;;${fmt(restore.luso)};${restore.lusoStock}\nGRO-ARROZ1;;${fmt(restore.arroz)};\nGRO-COLA33;5602000000919;${fmt(restore.colaCase)};\n`;
    const run = await previewImport(lx, { sheet: parseCsv(csv), mapping: { sku: "vendor_sku", ean: "gtin", price: "price", stock: "stock" }, source: "UPLOAD" });
    await applyImport(lx, run.id, { confirmBig: true });
  });

  it("previews without changing anything, then applies once", async () => {
    const lx = await ctxFor(LX);
    const luso = await offer("GRO-LUSO15", 6), cola = await offer("GRO-COLA33", 24);
    const newLuso = +(restore!.luso * 1.1).toFixed(2), newCola = +(restore!.colaCase * 0.95).toFixed(2);
    const csv = [
      "Referência;EAN;Preço;Stock;Prazo",
      `GRO-LUSO15;;${fmt(newLuso)};${restore!.lusoStock + 7};`,
      `GRO-ARROZ1;;${fmt(restore!.arroz)};;`, // same price → unchanged
      `GRO-COLA33;5602000000919;${fmt(newCola)};;`, // shared code, the barcode picks the 24-pack
      "GRO-COLA33;;1,00;;", // shared code without barcode → error
      "NOPE-404;;1,00;;", // unknown
      "GRO-MOZZ2;5602000000612;abc;;", // bad price
      "GRO-LUSO15;;;;-3", // bad lead time
    ].join("\n");
    const sheet = parseCsv(csv);
    const run = await previewImport(lx, { sheet, mapping: guessMapping(sheet.headers), source: "UPLOAD", fileName: "precos.csv" });
    const view = await importRun(lx, run.id);
    const st = view.rows.map((r) => r.status);
    expect(st).toEqual(["UPDATE", "UNCHANGED", "UPDATE", "ERROR", "NOT_FOUND", "ERROR", "ERROR"]);
    expect(view.rows[0].changes.join(" | ")).toMatch(/price .* → .*stock/);
    expect(view.rows[2].offerId).toBe(cola.id);
    expect(view.rows[3].errors[0]).toMatch(/pack sizes/);
    expect(view.summary).toMatchObject({ total: 7, updates: 2, unchanged: 1, notFound: 1, errors: 3, bigChanges: 0 });
    // Nothing changed yet.
    expect(await basePrice(luso.id)).toBe(restore!.luso);

    const res = await applyImport(lx, run.id);
    expect(res).toMatchObject({ applied: 2, failed: 0 });
    expect(await basePrice(luso.id)).toBeCloseTo(newLuso, 2);
    expect(await onHand(luso.id)).toBe(restore!.lusoStock + 7);
    expect(await basePrice(cola.id)).toBeCloseTo(newCola, 2);
    await expect(applyImport(lx, run.id)).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
    expect(await prisma.auditLog.count({ where: { action: "catalogue.import_applied", entityId: run.id } })).toBe(1);
  });

  it("asks for confirmation when a price changes by more than 50 %", async () => {
    const lx = await ctxFor(LX);
    const arroz = await offer("GRO-ARROZ1", 10);
    const run = await previewImport(lx, { sheet: parseCsv(`sku,price\nGRO-ARROZ1,"${(restore!.arroz * 3).toFixed(2)}"\n`), mapping: { sku: "vendor_sku", price: "price" }, source: "UPLOAD" });
    expect((await importRun(lx, run.id)).summary.bigChanges).toBe(1);
    await expect(applyImport(lx, run.id)).rejects.toMatchObject({ code: "BIG_CHANGES" });
    expect(await basePrice(arroz.id)).toBe(restore!.arroz);
    await applyImport(lx, run.id, { confirmBig: true });
    // Phase 29: an increase above FIRINGI's threshold isn't applied by the import either — it waits for approval
    expect(await basePrice(arroz.id)).toBe(restore!.arroz);
    const held = await prisma.priceChangeRequest.findFirstOrThrow({ where: { offerId: arroz.id, status: "PENDING" } });
    expect(Number(held.newPrice)).toBeCloseTo(restore!.arroz * 3, 2);
    await prisma.priceChangeRequest.delete({ where: { id: held.id } });
  });

  it("needs a column to match on and one to update; customers can't import", async () => {
    const lx = await ctxFor(LX), kebab = await ctxFor(KEBAB);
    const sheet = parseCsv("name;price\nX;1\n");
    await expect(previewImport(lx, { sheet, mapping: { name: "name", price: "price" }, source: "UPLOAD" })).rejects.toThrow(/product code or to the barcode/);
    await expect(previewImport(lx, { sheet: parseCsv("sku;name\nX;Y\n"), mapping: { sku: "vendor_sku", name: "name" }, source: "UPLOAD" })).rejects.toThrow(/at least one column to update/);
    await expect(previewImport(kebab, { sheet: parseCsv("sku;price\nX;1\n"), mapping: { sku: "vendor_sku", price: "price" }, source: "UPLOAD" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("URL guard", () => {
  it("knows private addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2a00:1450::1", "100.128.0.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses private, local and password URLs", async () => {
    const saved = process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS;
    delete process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS;
    try {
      for (const u of ["http://127.0.0.1/x", "http://localhost:3000/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://10.0.0.5/feed.csv", "http://printer.local/"]) await expect(assertPublicUrl(u), u).rejects.toThrow();
      await expect(assertPublicUrl("ftp://example.com/f.csv")).rejects.toThrow(/https/);
      await expect(assertPublicUrl("https://user:pw@example.com/f.csv")).rejects.toThrow(/password/);
      await expect(assertPublicUrl("not a url")).rejects.toThrow(/full address/);
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = saved;
    }
  });
});

describe("scheduled feeds", () => {
  let profileId = "", restorePrice = 0;
  beforeAll(async () => { restorePrice = (await basePrice((await offer("GRO-AZEITE75", 6)).id))!; });
  afterAll(async () => {
    const lx = await ctxFor(LX);
    routes.set("/feed.csv", { status: 200, body: `sku;ean;price\nGRO-AZEITE75;5602000000315;${fmt(restorePrice)}\n` });
    await runFeed(profileId, lx).catch(() => null);
    const run = await prisma.importRun.findFirst({ where: { profileId, status: "PREVIEW" }, orderBy: { createdAt: "desc" } });
    if (run) await applyImport(lx, run.id, { confirmBig: true });
    if (profileId) await deleteProfile(lx, profileId);
  });

  it("applies a sane feed, holds a suspicious one, records failures and tells once", async () => {
    const lx = await ctxFor(LX);
    const azeite = await offer("GRO-AZEITE75", 6);
    const mapping: Mapping = { sku: "vendor_sku", ean: "gtin", price: "price" };
    const p = await saveProfile(lx, { name: "Tabela diária", mapping, feedUrl: `${base}/feed.csv`, everyHours: 999 });
    profileId = p.id;
    expect(p.everyHours).toBe(168);

    const up = +(restorePrice * 1.05).toFixed(2);
    routes.set("/feed.csv", { status: 200, body: `sku;ean;price\nGRO-AZEITE75;5602000000315;${fmt(up)}\n` });
    const ok = await runFeed(p.id);
    expect(ok.status).toBe("APPLIED");
    expect(await basePrice(azeite.id)).toBeCloseTo(up, 2);

    routes.set("/feed.csv", { status: 200, body: `sku;ean;price\nGRO-AZEITE75;5602000000315;${fmt(up * 4)}\n` });
    const held = await runFeed(p.id);
    expect(held).toMatchObject({ status: "HELD" });
    expect(await basePrice(azeite.id)).toBeCloseTo(up, 2); // not applied
    expect(await prisma.notification.count({ where: { type: "integration.feed_held", link: `/vendor/products/import/${held.runId}` } })).toBeGreaterThan(0);
    await prisma.importRun.update({ where: { id: held.runId }, data: { status: "CANCELLED" } });

    routes.set("/feed.csv", { status: 500, body: "boom" });
    const before = await prisma.notification.count({ where: { type: "integration.feed_failed" } });
    expect(await runFeed(p.id)).toMatchObject({ status: "FAILED", error: expect.stringMatching(/HTTP 500/) });
    const afterFirst = await prisma.notification.count({ where: { type: "integration.feed_failed" } });
    expect(afterFirst).toBeGreaterThan(before);
    await runFeed(p.id);
    expect(await prisma.notification.count({ where: { type: "integration.feed_failed" } })).toBe(afterFirst); // told once
  });
});

describe("webhooks", () => {
  const ids: string[] = [];
  afterAll(async () => {
    const lx = await ctxFor(LX), kebab = await ctxFor(KEBAB);
    for (const id of ids) await deleteEndpoint(lx, id).catch(() => deleteEndpoint(kebab, id).catch(() => null));
  });

  it("offers the right events to each kind of company", async () => {
    expect(eventsFor("DISTRIBUTOR")).toEqual(["order.created", "order.status_changed", "payout.sent"]);
    expect(eventsFor("CUSTOMER")).toEqual(["order.placed", "order.status_changed", "invoice.issued", "payment.received"]);
    expect(eventsFor("WHOLESALER")).toHaveLength(6);
  });

  it("delivers signed order events to both sides, after the order is saved", async () => {
    const lx = await ctxFor(LX), kebab = await ctxFor(KEBAB);
    routes.set("/hooks/lx", { status: 200, body: "ok" });
    routes.set("/hooks/kebab", { status: 204, body: "" });
    const s = await createEndpoint(lx, { url: `${base}/hooks/lx`, events: ["order.created", "order.status_changed"] });
    const k = await createEndpoint(kebab, { url: `${base}/hooks/kebab`, events: ["order.placed", "order.status_changed", "order.created" /* a supplier event → dropped for a customer */] });
    ids.push(s.id, k.id);
    expect(s.secret).toMatch(/^whsec_/);
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: k.id } })).events).toEqual(["order.placed", "order.status_changed"]);
    expect((await listEndpoints(lx)).endpoints[0]).not.toHaveProperty("secret");

    // Place an order (Kebab House buys from Lisboa Central).
    const off = await offer("GRO-MOZZ2", 1);
    const wh = await warehouse();
    await setStock(lx, off.id, wh.id, Math.max(800, (await onHand(off.id)) + 100));
    await clearCart(kebab);
    await addToCart(kebab, off.id, 10);
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
    const o = await placeOrder(kebab, { deliveryAddressId: addr.id });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });

    hits.length = 0;
    await processWebhooks(new Date(Date.now() + 1000));
    const toLx = hits.filter((h) => h.path === "/hooks/lx"), toKebab = hits.filter((h) => h.path === "/hooks/kebab");
    expect(toKebab.map((h) => JSON.parse(h.body).event)).toEqual(["order.placed"]);
    expect(order.status).toBe("PENDING_CONFIRMATION"); // Kebab House: no risk hold, no pay-first
    {
      expect(toLx.map((h) => JSON.parse(h.body).event)).toEqual(["order.created"]);
      const h = toLx[0];
      const body = JSON.parse(h.body);
      expect(body.data).toMatchObject({ orderId: o.id, number: order.number, status: "PENDING_CONFIRMATION" });
      expect(body).not.toHaveProperty("data.grandTotal");
      // Signature: t=…,v1=HMAC(secret, t.body)
      const [, t, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(String(h.headers["x-firingi-signature"]))!;
      expect(v1).toBe(createHmac("sha256", s.secret).update(`${t}.${h.body}`).digest("hex"));
      expect(h.headers["x-firingi-event"]).toBe("order.created");
      expect(h.headers["x-firingi-delivery"]).toBe(body.id);

      // Supplier confirms → both hear "status changed".
      await confirmOrder(lx, o.id, {});
      hits.length = 0;
      await processWebhooks(new Date(Date.now() + 1000));
      expect(hits.map((x) => `${x.path} ${JSON.parse(x.body).event} ${JSON.parse(x.body).data.status}`).sort()).toEqual([
        "/hooks/kebab order.status_changed SUPPLIER_PROCESSING", "/hooks/lx order.status_changed SUPPLIER_PROCESSING",
      ]);
      await changeOrderStatus(lx, o.id, "CANCELLED", "test").catch(() => null);
    }
    expect(await prisma.webhookDelivery.count({ where: { endpointId: { in: [s.id, k.id] }, status: "PENDING" } })).toBe(0);
  });

  it("an event in a rolled-back transaction is never sent", async () => {
    const kebab = await ctxFor(KEBAB);
    const k = await createEndpoint(kebab, { url: `${base}/hooks/kebab`, events: ["invoice.issued"] });
    ids.push(k.id);
    await expect(prisma.$transaction(async (tx) => {
      expect(await emitWebhook(tx, kebab.company.id, "invoice.issued", { invoiceId: "x" })).toBe(1);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await prisma.webhookDelivery.count({ where: { endpointId: k.id } })).toBe(0);
  });

  it("retries with back-off and switches a failing endpoint off after 20 failures", async () => {
    const lx = await ctxFor(LX);
    routes.set("/hooks/down", { status: 503, body: "maintenance" });
    const e = await createEndpoint(lx, { url: `${base}/hooks/down`, events: ["order.created"] });
    ids.push(e.id);
    await prisma.$transaction((tx) => emitWebhook(tx, lx.company.id, "order.created", { orderId: "o1" }));
    // (other endpoints of Lisboa Central also got it — only this one fails)
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: e.id } });
    await processWebhooks(new Date(Date.now() + 1000));
    const after1 = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(after1).toMatchObject({ status: "PENDING", attempts: 1, responseCode: 503 });
    expect(after1.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(50_000); // ≈ 1 min later
    // Not due yet → not sent again.
    await processWebhooks();
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).attempts).toBe(1);

    // 19 failures so far → the 20th switches it off and tells the company.
    await prisma.webhookEndpoint.update({ where: { id: e.id }, data: { failureStreak: 19 } });
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await processWebhooks();
    const ep = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: e.id } });
    expect(ep.active).toBe(false);
    expect(ep.disabledReason).toMatch(/20 failed deliveries/);
    expect(await prisma.notification.count({ where: { type: "integration.webhook_disabled", userId: lx.user.id, createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeGreaterThan(0);
  });

  it("sends a test ping and reports the answer; refuses private URLs", async () => {
    const lx = await ctxFor(LX);
    routes.set("/hooks/ping", { status: 200, body: "pong" });
    const e = await createEndpoint(lx, { url: `${base}/hooks/ping`, events: ["order.created"] });
    ids.push(e.id);
    expect(await sendTest(lx, e.id)).toEqual({ ok: true, status: 200, body: "pong" });
    expect(signPayload("s", "{}", 1)).toBe(`t=1,v1=${createHmac("sha256", "s").update("1.{}").digest("hex")}`);
    const saved = process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS;
    delete process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS;
    try {
      await expect(createEndpoint(lx, { url: "http://10.0.0.1/hook", events: ["order.created"] })).rejects.toThrow(/private network/);
    } finally {
      process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = saved;
    }
  });
});
