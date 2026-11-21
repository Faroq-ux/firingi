/**
 * Phase 58: ordering by WhatsApp with the simulated AI (no live API calls): an inbound message from the business's
 * WhatsApp number → the agent fills the cart and proposes the order → only YES places that exact cart (NO cancels,
 * a changed cart or an expired proposal places nothing); voice notes; audiences and per-business switch; staff
 * take-over; status updates; reminders; and the monthly small-order limit at checkout.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ctxFor } from "../helpers";
import { storeInboundForTests } from "@/server/services/notifications";
import { orderStatusChanged, processInbound, runWhatsAppJob, saveWaSettings, setConversationPause, waOverview, waSettings } from "@/server/whatsapp/ordering";
import { DEFAULT_WA } from "@/lib/wa-ordering";
import { setCompanyFeature } from "@/server/accounting/features";
import { addToCart, cartView, clearCart } from "@/server/services/cart";
import { saveSmallOrderSettings, setCompanySmallOrders, smallOrderStatus } from "@/server/orders/small-orders";
import { placeOrder } from "@/server/services/orders";
import pt from "@/messages/pt-PT.json";

/** A +351 number with no user language gets FIRINGI's messages in Portuguese. */
const PT = pt.waOrder.bot;

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
const NUM = "+351910000058", LXNUM = "+351910000059", UNKNOWN = "+351910000099";
let kebabId = "", lxId = "", seq = 0;
const env = { ...process.env };

const inbound = async (from: string, body: string, extra: { kind?: string; mediaType?: string | null; mediaUrl?: string | null } = {}) => {
  const id = await storeInboundForTests("WHATSAPP", `whatsapp:${from}`, body, `wa-it-${Date.now()}-${++seq}`, extra.mediaUrl ?? null, { kind: extra.kind as never, mediaType: extra.mediaType ?? null });
  if (!id) throw new Error("not stored");
  return { id, result: await processInbound(id) };
};
const lastOut = async (to: string) => (await prisma.notificationMessage.findFirst({ where: { to, channel: "WHATSAPP" }, orderBy: { createdAt: "desc" } }))?.body ?? "";
const pending = (companyId: string) => prisma.waOrderDraft.findFirst({ where: { companyId, status: "PENDING" }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  process.env.ASSISTANT_SIMULATE = "1";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WA_MEDIA_SIMULATE = "1";
  kebabId = (await ctxFor(KEBAB)).company.id;
  lxId = (await ctxFor(LX)).company.id;
  await prisma.company.update({ where: { id: kebabId }, data: { whatsapp: NUM } });
  await prisma.company.update({ where: { id: lxId }, data: { whatsapp: LXNUM } });
  await saveWaSettings(await ctxFor(SA), DEFAULT_WA);
});
beforeEach(async () => {
  await prisma.waOrderDraft.updateMany({ where: { companyId: { in: [kebabId, lxId] }, status: "PENDING" }, data: { status: "CANCELLED" } });
  await prisma.aiConversation.updateMany({ where: { companyId: kebabId, channel: "WHATSAPP" }, data: { aiPausedUntil: null } });
  await clearCart(await ctxFor(KEBAB));
});
afterAll(async () => {
  process.env = env;
  await prisma.company.update({ where: { id: kebabId }, data: { whatsapp: null, smallOrdersPerMonth: null, smallOrdersUnlimited: false } });
  await prisma.company.update({ where: { id: lxId }, data: { whatsapp: null } });
  await prisma.companyFeature.deleteMany({ where: { key: "WHATSAPP_ORDERING", companyId: kebabId } });
  await prisma.setting.deleteMany({ where: { key: { in: ["whatsapp.ordering", "orders.smallOrders"] } } });
  await clearCart(await ctxFor(KEBAB));
  await prisma.$disconnect();
});

describe("WhatsApp ordering", () => {
  it("a message fills the cart and proposes; YES places exactly that cart, marked WhatsApp", async () => {
    const r = await inbound(NUM, "add 6 Arroz");
    expect(r.result).toBe("DONE");
    const d = await pending(kebabId);
    expect(d).not.toBeNull();
    const out = await lastOut(NUM);
    expect(out).toMatch(/Total .* incl\. VAT/);
    expect(out).toContain(PT.confirmHint);
    expect(out).not.toContain("**");
    const yes = await inbound(NUM, "Sim!");
    expect(yes.result).toBe("DONE");
    const placed = await prisma.waOrderDraft.findUniqueOrThrow({ where: { id: d!.id } });
    expect(placed.status).toBe("PLACED");
    expect(placed.orderNumbers.length).toBeGreaterThan(0);
    const orders = await prisma.order.findMany({ where: { id: { in: placed.orderIds } } });
    expect(orders.every((o) => o.placedVia === "WHATSAPP" && o.buyerCompanyId === kebabId)).toBe(true);
    expect(await lastOut(NUM)).toContain(placed.orderNumbers[0]);
  });

  it("NO cancels; a changed cart or an expired proposal places nothing", async () => {
    await inbound(NUM, "add 6 Arroz");
    const a = await pending(kebabId);
    await inbound(NUM, "no");
    expect((await prisma.waOrderDraft.findUniqueOrThrow({ where: { id: a!.id } })).status).toBe("CANCELLED");

    await inbound(NUM, "place my order");
    const b = await pending(kebabId);
    expect(b).not.toBeNull();
    const ctx = await ctxFor(KEBAB);
    const line = (await cartView(ctx)).lines[0];
    await addToCart(ctx, line.offerId, 1);
    const before = await prisma.order.count({ where: { buyerCompanyId: kebabId } });
    await inbound(NUM, "yes");
    expect((await prisma.waOrderDraft.findUniqueOrThrow({ where: { id: b!.id } })).status).toBe("CHANGED");
    expect(await prisma.order.count({ where: { buyerCompanyId: kebabId } })).toBe(before);

    await inbound(NUM, "place my order");
    const c = await pending(kebabId);
    await prisma.waOrderDraft.update({ where: { id: c!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await inbound(NUM, "yes");
    expect((await prisma.waOrderDraft.findUniqueOrThrow({ where: { id: c!.id } })).status).toBe("EXPIRED");
    expect(await prisma.order.count({ where: { buyerCompanyId: kebabId } })).toBe(before);
  });

  it("a voice note is transcribed and handled like text", async () => {
    process.env.STT_SIMULATE_TEXT = "add 6 Arroz";
    const r = await inbound(NUM, "[voice]", { kind: "AUDIO", mediaType: "audio/ogg", mediaUrl: "https://media.test/voice.ogg" });
    expect(r.result).toBe("DONE");
    expect((await prisma.inboundMessage.findUniqueOrThrow({ where: { id: r.id } })).transcript).toBe("add 6 Arroz");
    expect(await pending(kebabId)).not.toBeNull();
  });

  it("who may order: wholesalers and unknown numbers off by default, each a switch; a business can be switched off", async () => {
    expect((await inbound(LXNUM, "add 2 Coca-Cola")).result).toBe("SKIPPED");
    expect((await inbound(UNKNOWN, "hello")).result).toBe("SKIPPED");
    await saveWaSettings(await ctxFor(SA), { ...DEFAULT_WA, audiences: { customers: true, wholesalers: false, unknownNumbers: true } });
    expect((await inbound(UNKNOWN, "hello")).result).toBe("DONE");
    expect(await lastOut(UNKNOWN)).toContain("/register");
    await saveWaSettings(await ctxFor(SA), DEFAULT_WA);

    await setCompanyFeature(await ctxFor(SA), kebabId, "WHATSAPP_ORDERING", false);
    expect((await inbound(NUM, "add 2 Coca-Cola")).result).toBe("SKIPPED");
    await setCompanyFeature(await ctxFor(SA), kebabId, "WHATSAPP_ORDERING", true);

    await saveWaSettings(await ctxFor(SA), { ...DEFAULT_WA, enabled: false });
    expect((await inbound(NUM, "add 2 Coca-Cola")).result).toBe("SKIPPED");
    await saveWaSettings(await ctxFor(SA), DEFAULT_WA);
  });

  it("staff take over a conversation; the AI stays quiet until given back", async () => {
    await inbound(NUM, "what do I owe?");
    const conv = await prisma.aiConversation.findFirstOrThrow({ where: { companyId: kebabId, channel: "WHATSAPP" }, orderBy: { updatedAt: "desc" } });
    await setConversationPause(await ctxFor(SA), conv.id, true);
    expect((await inbound(NUM, "hello?")).result).toBe("SKIPPED");
    await setConversationPause(await ctxFor(SA), conv.id, false);
    expect((await inbound(NUM, "what do I owe?")).result).toBe("DONE");
    await expect(setConversationPause(await ctxFor(KEBAB), conv.id, true)).rejects.toThrow();
    const ov = await waOverview(await ctxFor(SA));
    expect(ov.conversations.some((c) => c.id === conv.id)).toBe(true);
  });

  it("order updates come back on WhatsApp (within the 24-hour window)", async () => {
    const o = await prisma.order.findFirstOrThrow({ where: { buyerCompanyId: kebabId, placedVia: "WHATSAPP" }, orderBy: { placedAt: "desc" } });
    await orderStatusChanged(o.id, "OUT_FOR_DELIVERY");
    expect(await lastOut(NUM)).toBe(PT.status.OUT_FOR_DELIVERY.replace("{number}", o.number));
  });

  it("the job answers pending messages and expires old proposals", async () => {
    await inbound(NUM, "add 6 Arroz");
    const d = await pending(kebabId);
    await prisma.waOrderDraft.update({ where: { id: d!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const queued = await storeInboundForTests("WHATSAPP", `whatsapp:${NUM}`, "what do I owe?", `wa-it-job-${Date.now()}`);
    await prisma.inboundMessage.update({ where: { id: queued! }, data: { receivedAt: new Date(Date.now() - 60_000) } }); // the job takes messages older than 15 s
    const r = await runWhatsAppJob();
    expect(r.pending).toBeGreaterThanOrEqual(1);
    expect((await prisma.inboundMessage.findUniqueOrThrow({ where: { id: queued! } })).aiStatus).toBe("DONE");
    expect((await prisma.waOrderDraft.findUniqueOrThrow({ where: { id: d!.id } })).status).toBe("EXPIRED");
    expect((await waSettings()).audiences.customers).toBe(true);
  });
});

describe("small orders per month", () => {
  it("off by default; when used up the cart and checkout ask for the supplier's free-delivery amount", async () => {
    const ctx = await ctxFor(KEBAB);
    expect((await smallOrderStatus(kebabId, "CUSTOMER")).limit).toBeNull();
    await saveSmallOrderSettings(await ctxFor(SA), { enabled: true, perMonth: 0 });
    const s = await smallOrderStatus(kebabId, "CUSTOMER");
    expect(s).toMatchObject({ limit: 0, left: 0 });

    await inbound(NUM, "add 6 Arroz");
    const view = await cartView(ctx);
    const g = view.groups.find((x) => x.delivery && !x.delivery.ok && x.delivery.reason === "SMALL_ORDER_LIMIT");
    const smallGroup = view.groups.some((x) => x.delivery?.ok && x.delivery.mode === "FIRINGI_FLEET");
    // either the cart already reaches the supplier's free delivery, or it is blocked with the amount to add
    expect(!!g || !smallGroup).toBe(true);
    if (g) {
      const addr = view.addresses[0].id;
      await expect(placeOrder(ctx, { deliveryAddressId: addr } as never)).rejects.toThrow(/small orders/);
    }

    await setCompanySmallOrders(await ctxFor(SA), kebabId, { perMonth: null, unlimited: true });
    expect((await smallOrderStatus(kebabId, "CUSTOMER")).limit).toBeNull();
    await expect(setCompanySmallOrders(await ctxFor(SA), lxId, { perMonth: 2, unlimited: false })).rejects.toThrow(/wholesale customers/);
    await expect(saveSmallOrderSettings(await ctxFor(KEBAB), { enabled: false, perMonth: 1 })).rejects.toThrow();
  });
});
