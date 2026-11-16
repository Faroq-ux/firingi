/**
 * Phase 35: order chat — who sees which conversation (buyer, supplier, FIRINGI, driver), the supplier
 * hidden on orders FIRINGI routed, contact details hidden and flagged (per company switch), FIRINGI's
 * switches (global, per channel, per company), the driver thread only around the delivery, AI
 * translation into the reader's language (cached), unread counts, inbox, notifications, photos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { setCompanyFeature } from "@/server/accounting/features";
import * as chat from "@/server/chat/service";
import { screenContacts, DEFAULT_CHAT } from "@/lib/chat";
import { ctxFor, pngFile } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", OPS = "ops@firingi.test", SA = "superadmin@firingi.test", DRV = "driver@firingi.test", IB = "owner@ibericas.test";

async function wipe() {
  await prisma.orderThread.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "chat.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["CHAT", "CHAT_MASK"] } } });
}
beforeAll(wipe);
afterAll(async () => { chat.setChatTranslatorForTests(null); await wipe(); await prisma.$disconnect(); });

async function order(sku: string, qty: number, unitsPerPack?: number) {
  const kebab = await ctxFor(KEBAB);
  const lx = await ctxFor(LX);
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku }, ...(unitsPerPack ? { unitsPerPack } : {}) } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
  await confirmOrder(lx, id, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
  return { orderId: id, deliveryId: d.id };
}
const chans = (v: chat.ChatView) => v.channels.map((c) => c.channel).sort();
const ch = (v: chat.ChatView, c: string) => v.channels.find((x) => x.channel === c)!;
const send = async (email: string, orderId: string, portal: chat.Portal, channel: "BUYER_SUPPLIER" | "BUYER_FIRINGI" | "SUPPLIER_FIRINGI" | "DRIVER", body: string, extra: { locale?: string; photos?: File[] } = {}) =>
  chat.sendOrderMessage(await ctxFor(email), orderId, portal, { channel, body, ...extra });

describe("contact filter", () => {
  it("hides phones, e-mails, IBANs and links; keeps order numbers, prices, dates, postcodes", () => {
    expect(screenContacts("Ligue 912 345 678 ou +351 912345678").text).toBe("Ligue [•••] ou [•••]");
    expect(screenContacts("joao.silva@gmail.com / joao at gmail dot com").flags).toEqual(["EMAIL"]);
    expect(screenContacts("IBAN PT50 0002 0123 1234 5678 9015 4").flags).toEqual(["IBAN"]);
    expect(screenContacts("www.loja.pt").flags).toEqual(["LINK"]);
    const keep = "FO-2026-000100 chega 16/11/2026 às 08:49, 156,00 €, 1100-319 Lisboa, 8 caixas";
    expect(screenContacts(keep)).toEqual({ text: keep, flags: [] });
    expect(screenContacts("912 345 678", false)).toEqual({ text: "912 345 678", flags: ["PHONE"] });
  });
});

describe("order chat", () => {
  it("buyer ↔ supplier ↔ FIRINGI: each sees only their conversations; contacts hidden and flagged", async () => {
    const o = await order("FIR-PIZZABOX33", 8);
    const buyerView = await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy");
    expect(buyerView.as).toBe("BUYER");
    expect(chans(buyerView)).toEqual(["BUYER_FIRINGI", "BUYER_SUPPLIER"]); // no driver yet
    const supView = await chat.orderChat(await ctxFor(LX), o.orderId, "vendor");
    expect(chans(supView)).toEqual(["BUYER_SUPPLIER", "SUPPLIER_FIRINGI"]);
    const staff = await chat.orderChat(await ctxFor(OPS), o.orderId, "admin");
    expect(chans(staff)).toEqual(["BUYER_FIRINGI", "BUYER_SUPPLIER", "SUPPLIER_FIRINGI"]);

    // strangers and wrong portals see nothing
    await expect(chat.orderChat(await ctxFor(IB), o.orderId, "vendor")).rejects.toThrow(/not found/i);
    await expect(chat.orderChat(await ctxFor(KEBAB), o.orderId, "vendor")).rejects.toThrow(/not found/i);
    await expect(send(KEBAB, o.orderId, "buy", "SUPPLIER_FIRINGI", "hello")).rejects.toThrow(/not found/i);

    const r = await send(KEBAB, o.orderId, "buy", "BUYER_SUPPLIER", "Podem entregar antes das 10h? Liguem 912 345 678", { locale: "pt" });
    expect(r.hidden).toBe(true);
    expect(r.flags).toEqual(["PHONE"]);
    await send(LX, o.orderId, "vendor", "SUPPLIER_FIRINGI", "Stock de caixas baixo esta semana", { locale: "pt" });

    const sup = ch(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor"), "BUYER_SUPPLIER");
    expect(sup.messages).toHaveLength(1);
    expect(sup.messages[0].body).toBe("Podem entregar antes das 10h? Liguem [•••]");
    expect(sup.messages[0].company).toBe("Kebab House");
    expect("typed" in sup.messages[0]).toBe(false); // the original is FIRINGI's only
    expect(sup.unread).toBe(1);
    await chat.markThreadRead(await ctxFor(LX), o.orderId, "BUYER_SUPPLIER", "vendor");
    expect(ch(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor"), "BUYER_SUPPLIER").unread).toBe(0);

    // the buyer never sees the supplier ↔ FIRINGI thread; FIRINGI sees everything with what was typed
    expect(chans(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy"))).not.toContain("SUPPLIER_FIRINGI");
    const s2 = await chat.orderChat(await ctxFor(OPS), o.orderId, "admin");
    const m = ch(s2, "BUYER_SUPPLIER").messages[0] as { typed?: string | null; flags?: string[] };
    expect(m.typed).toContain("912 345 678");
    expect(m.flags).toEqual(["PHONE"]);
    expect(ch(s2, "SUPPLIER_FIRINGI").messages[0].body).toMatch(/Stock de caixas/);

    // FIRINGI answers both; staff text is never screened
    await send(OPS, o.orderId, "admin", "SUPPLIER_FIRINGI", "Ok — call us on 210 000 000");
    expect(ch(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor"), "SUPPLIER_FIRINGI").messages[1].body).toMatch(/210 000 000/);

    // flagged list + review
    const flagged = await chat.flaggedMessages(await ctxFor(OPS));
    const f = flagged.find((x) => x.number && x.typed.includes("912 345 678"))!;
    expect(f.company).toBe("Kebab House");
    await expect(chat.reviewFlagged(await ctxFor(KEBAB), f.id)).rejects.toThrow();
    await chat.reviewFlagged(await ctxFor(OPS), f.id);
    expect((await chat.flaggedMessages(await ctxFor(OPS))).some((x) => x.id === f.id)).toBe(false);

    // notifications: the supplier was told about the buyer's message
    const lxUsers = await prisma.membership.findMany({ where: { companyId: (await ctxFor(LX)).company.id }, select: { userId: true } });
    expect(await prisma.notification.count({ where: { userId: { in: lxUsers.map((u) => u.userId) }, type: "chat.message", link: { contains: o.orderId } } })).toBeGreaterThan(0);

    // inbox
    const inbox = await chat.chatInbox(await ctxFor(KEBAB), "buy");
    const row = inbox.find((x) => x.orderId === o.orderId && x.channel === "BUYER_SUPPLIER")!;
    expect(row.with).toBe("Lisboa Central");
    expect((await chat.chatInbox(await ctxFor(KEBAB), "buy")).some((x) => x.channel === "SUPPLIER_FIRINGI")).toBe(false);
    expect((await chat.chatInbox(await ctxFor(OPS), "admin")).filter((x) => x.orderId === o.orderId)).toHaveLength(2);
  });

  it("orders FIRINGI routed: no buyer ↔ supplier thread; the supplier stays hidden from the buyer", async () => {
    const o = await order("FIR-PIZZABOX33", 8);
    await prisma.order.update({ where: { id: o.orderId }, data: { routedByFiringi: true } });
    expect(chans(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy"))).toEqual(["BUYER_FIRINGI"]);
    expect(chans(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor"))).toEqual(["SUPPLIER_FIRINGI"]);
    await expect(send(LX, o.orderId, "vendor", "BUYER_SUPPLIER", "hi")).rejects.toThrow(/not found/i);
    await send(KEBAB, o.orderId, "buy", "BUYER_FIRINGI", "Onde está a minha encomenda?");
    const inbox = await chat.chatInbox(await ctxFor(KEBAB), "buy");
    expect(inbox.find((x) => x.orderId === o.orderId)!.with).toBe("FIRINGI");
  });

  it("FIRINGI's switches: channel off, company off, hiding off for a company, chat off", async () => {
    const o = await order("FIR-PIZZABOX33", 8);
    const sa = await ctxFor(SA);
    await expect(chat.saveChatSettings(await ctxFor(LX), { enabled: false })).rejects.toThrow();
    await expect(chat.saveChatSettings(sa, { driverHoursAfter: 100 })).rejects.toThrow(/72/);
    await chat.saveChatSettings(sa, { channels: { ...DEFAULT_CHAT.channels, BUYER_SUPPLIER: false } });
    expect(chans(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy"))).toEqual(["BUYER_FIRINGI"]);
    await expect(send(KEBAB, o.orderId, "buy", "BUYER_SUPPLIER", "hi")).rejects.toThrow(/switched off/);
    const staff = ch(await chat.orderChat(await ctxFor(OPS), o.orderId, "admin"), "BUYER_SUPPLIER");
    expect(staff.why).toBe("OFF");
    expect(staff.canWrite).toBe(false);
    await chat.saveChatSettings(sa, { channels: DEFAULT_CHAT.channels });

    // chat off for the buyer's company: its conversations close
    await setCompanyFeature(sa, (await ctxFor(KEBAB)).company.id, "CHAT", false);
    expect(chans(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy"))).toEqual([]);
    expect(chans(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor"))).toEqual(["SUPPLIER_FIRINGI"]);
    await setCompanyFeature(sa, (await ctxFor(KEBAB)).company.id, "CHAT", true);

    // hiding off for the supplier: flagged but shown as typed
    await setCompanyFeature(sa, (await ctxFor(LX)).company.id, "CHAT_MASK", false);
    const r = await send(LX, o.orderId, "vendor", "BUYER_SUPPLIER", "O nosso armazém: 912 345 678");
    expect(r).toMatchObject({ hidden: false, flags: [] });
    const m = await prisma.orderMessage.findUniqueOrThrow({ where: { id: r.id } });
    expect(m.body).toMatch(/912 345 678/);
    expect(m.flags).toEqual(["PHONE"]);
    await setCompanyFeature(sa, (await ctxFor(LX)).company.id, "CHAT_MASK", true);

    // the whole chat off
    await chat.saveChatSettings(sa, { enabled: false });
    await expect(send(KEBAB, o.orderId, "buy", "BUYER_FIRINGI", "hello")).rejects.toThrow(/switched off/);
    await chat.saveChatSettings(sa, { enabled: true });
  });

  it("driver thread: driver, buyer and FIRINGI while on the road; closes after the delivery; photos", async () => {
    const o = await order("FIR-MOZZ2", 5, 1); // FIRINGI fleet
    const ops = await ctxFor(OPS);
    const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: DRV } } });
    await prisma.delivery.updateMany({ where: { driverId: driver.id, status: "ASSIGNED", id: { not: o.deliveryId } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
    await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
    await expect(chat.orderChat(await ctxFor(DRV), o.orderId, "driver")).rejects.toThrow(/not found/i); // not assigned yet
    await assignDelivery(ops, o.deliveryId, { driverId: driver.id });

    const dv = await chat.orderChat(await ctxFor(DRV), o.orderId, "driver");
    expect(chans(dv)).toEqual(["DRIVER"]);
    expect(chans(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy"))).toContain("DRIVER");
    expect(chans(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor"))).not.toContain("DRIVER"); // FIRINGI runs this delivery

    const r = await send(DRV, o.orderId, "driver", "DRIVER", "Estou à porta, está fechado", { photos: [pngFile("door.png")] });
    const bv = ch(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy"), "DRIVER");
    expect(bv.messages[0]).toMatchObject({ side: "DRIVER", company: null, photos: 1 });
    expect(await chat.chatPhotoKey(await ctxFor(KEBAB), r.id, 0, "buy")).toBeTruthy();
    await expect(chat.chatPhotoKey(await ctxFor(LX), r.id, 0, "vendor")).rejects.toThrow();
    await send(KEBAB, o.orderId, "buy", "DRIVER", "Já vou abrir!");
    expect((await chat.chatInbox(await ctxFor(DRV), "driver")).find((x) => x.orderId === o.orderId)!.unread).toBe(1);

    // delivered → closed for the driver and the buyer once the window has passed
    await chat.saveChatSettings(await ctxFor(SA), { driverHoursAfter: 0 });
    await changeOrderStatus(await ctxFor(LX), o.orderId, "READY_FOR_PICKUP");
    const drv = await ctxFor(DRV);
    await pickUp(drv, o.deliveryId);
    await startDelivery(drv, o.deliveryId);
    await completeDelivery(drv, o.deliveryId, { recipientName: "Ahmed", signature: pngFile("sig.png") });
    await new Promise((res) => setTimeout(res, 20));
    expect(ch(await chat.orderChat(await ctxFor(DRV), o.orderId, "driver"), "DRIVER").why).toBe("DRIVER_ENDED");
    await expect(send(KEBAB, o.orderId, "buy", "DRIVER", "obrigado")).rejects.toThrow(/delivery has ended/);
    await chat.saveChatSettings(await ctxFor(SA), { driverHoursAfter: DEFAULT_CHAT.driverHoursAfter });
  });

  it("translation into the reader's language, made once and reused; off when switched off", async () => {
    const o = await order("FIR-PIZZABOX33", 8);
    let calls = 0;
    chat.setChatTranslatorForTests(async (text, to) => { calls++; return `(${to}) ${text}`; });
    await send(KEBAB, o.orderId, "buy", "BUYER_SUPPLIER", "Faltou uma caixa", { locale: "pt" });
    const en = ch(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor", { locale: "en" }), "BUYER_SUPPLIER").messages[0];
    expect(en).toMatchObject({ body: "(en) Faltou uma caixa", translated: true, original: "Faltou uma caixa" });
    await chat.orderChat(await ctxFor(LX), o.orderId, "vendor", { locale: "en" });
    expect(calls).toBe(1); // cached
    // the author's own message stays as written, whatever language they read in
    expect(ch(await chat.orderChat(await ctxFor(KEBAB), o.orderId, "buy", { locale: "en" }), "BUYER_SUPPLIER").messages[0].translated).toBe(false);
    const pt = ch(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor", { locale: "pt" }), "BUYER_SUPPLIER").messages[0];
    expect(pt.translated).toBe(false); // same language: as written
    await chat.saveChatSettings(await ctxFor(SA), { translate: false });
    expect(ch(await chat.orderChat(await ctxFor(LX), o.orderId, "vendor", { locale: "de" }), "BUYER_SUPPLIER").messages[0].translated).toBe(false);
    await chat.saveChatSettings(await ctxFor(SA), { translate: true });
    chat.setChatTranslatorForTests(null);
  });

  it("validation: empty, too long, photos only images, overview counts", async () => {
    const o = await order("FIR-PIZZABOX33", 8);
    await expect(send(KEBAB, o.orderId, "buy", "BUYER_FIRINGI", "   ")).rejects.toThrow(/Write a message/);
    await expect(send(KEBAB, o.orderId, "buy", "BUYER_FIRINGI", "x".repeat(2001))).rejects.toThrow(/2000/);
    const pdf = new File([Buffer.from("%PDF-1.4\n%%EOF")], "a.pdf", { type: "application/pdf" });
    await expect(send(KEBAB, o.orderId, "buy", "BUYER_FIRINGI", "see", { photos: [pdf] })).rejects.toThrow(/images/);
    const ov = await chat.chatOverview(await ctxFor(OPS));
    expect(ov.messages30).toBeGreaterThan(3);
    expect(ov.channels.find((c) => c.channel === "DRIVER")!.threads).toBeGreaterThan(0);
    await expect(chat.chatOverview(await ctxFor(KEBAB))).rejects.toThrow();
  });
});
