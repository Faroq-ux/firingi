/**
 * Phase 7: notification events, recipients, channels, preferences & consent, templates,
 * providers (Twilio / Meta, mocked), retries, webhooks and the inbound inbox.
 */
import { createHmac } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { notify, processOutbox } from "@/server/notify/dispatch";
import { channelsFor, eventDef, fill, normalisePhone } from "@/server/notify/events";
import {
  conversation, handleMeta, handleTwilio, inbox, markRead, metaSignatureValid, myPreferences, reply, retryMessage, saveTemplate,
  savePreferences, setChannelEnabled, setEventChannels, twilioSignatureValid, unreadCount,
} from "@/server/services/notifications";
import { ctxFor } from "../helpers";

const LX = "Grossista Lisboa Central, Lda";
const OPS = "ops@firingi.test";
const SA = "superadmin@firingi.test";
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
afterAll(() => prisma.$disconnect());

const lxId = async () => (await prisma.company.findFirstOrThrow({ where: { legalName: LX } })).id;
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
const tag = Date.now().toString(36);
const msgs = (eventKey: string, since: Date) => prisma.notificationMessage.findMany({ where: { eventKey, createdAt: { gte: since } }, include: { user: { select: { email: true } } } });

describe("event rules (pure)", () => {
  it("fills placeholders and tidies punctuation", () => {
    expect(fill("Order {number} was cancelled. {reason}", { number: "FO-1", reason: "" })).toBe("Order FO-1 was cancelled.");
    expect(fill("Hello {name} !", { name: "Ana" })).toBe("Hello Ana!");
  });
  it("normalises phone numbers", () => {
    expect(normalisePhone("+351 912 345 678")).toBe("+351912345678");
    expect(normalisePhone("00351912345678")).toBe("+351912345678");
    expect(normalisePhone("912345678")).toBeNull();
  });
  it("in-app is always on; critical events keep e-mail even if switched off", () => {
    const all = new Set(["EMAIL", "SMS", "WHATSAPP", "PUSH"] as const);
    expect(channelsFor(eventDef("order.new"), ["EMAIL", "PUSH"], all, { EMAIL: false })).toEqual(["IN_APP", "PUSH"]);
    expect(channelsFor(eventDef("company.suspended"), ["EMAIL"], all, { EMAIL: false })).toEqual(["IN_APP", "EMAIL"]);
    expect(channelsFor(eventDef("order.new"), ["EMAIL", "WHATSAPP"], new Set(["EMAIL"] as const), {})).toEqual(["IN_APP", "EMAIL"]);
  });
});

describe("recipients, channels, consent", () => {
  it("order.new reaches the vendor's order people, not its buy-only employee", async () => {
    const since = new Date();
    await notify("order.new", [{ companyId: await lxId(), link: "/vendor/orders/x" }], { number: `FO-T-${tag}`, buyer: "Kebab House", total: "10,00 €" });
    const inApp = await prisma.notification.findMany({ where: { type: "order.new", createdAt: { gte: since } }, include: { user: { select: { email: true } } } });
    const emails = inApp.map((n) => n.user.email);
    expect(emails).toContain("owner@lisboacentral.test");
    expect(emails).toContain("warehouse@lisboacentral.test");
    expect(emails).not.toContain("purchasing@lisboacentral.test");
    expect(inApp[0].body).toContain(`FO-T-${tag}`);
    expect(inApp[0].link).toBe("/vendor/orders/x");
    const mail = (await msgs("order.new", since)).filter((m) => m.channel === "EMAIL");
    expect(mail.length).toBe(emails.length);
    expect(mail.every((m) => m.status === "SENT" && m.provider === "log")).toBe(true);
    expect(mail[0].body).toContain("http://localhost:3000/vendor/orders/x");
    // No phone / consent → WhatsApp logged as skipped, not sent.
    expect((await msgs("order.new", since)).filter((m) => m.channel === "WHATSAPP").every((m) => m.status === "SKIPPED")).toBe(true);
  });

  it("phone + consent turn on WhatsApp/SMS; switching e-mail off for orders is respected", async () => {
    const owner = await ctxFor("owner@lisboacentral.test");
    await expect(savePreferences(owner, { prefs: [], phone: "912", smsConsent: false, whatsappConsent: false })).rejects.toThrow(/country code/);
    await expect(savePreferences(owner, { prefs: [], phone: "", smsConsent: false, whatsappConsent: true })).rejects.toThrow(/mobile number/);
    await savePreferences(owner, { prefs: [{ category: "orders", channel: "EMAIL", enabled: false }], phone: "+351 912 000 111", smsConsent: true, whatsappConsent: true });
    const p = await myPreferences(owner);
    expect(p.phone).toBe("+351912000111");
    expect(p.categories.find((c) => c.category === "orders")!.channels.find((c) => c.channel === "EMAIL")!.enabled).toBe(false);

    const since = new Date();
    await notify("order.new", [{ companyId: await lxId() }], { number: `FO-W-${tag}` });
    const mine = (await msgs("order.new", since)).filter((m) => m.userId === owner.user.id);
    expect(mine.map((m) => `${m.channel}:${m.status}`).sort()).toEqual(["WHATSAPP:SENT"]);
    expect(mine[0].to).toBe("+351912000111");
    expect(mine[0].body.startsWith("FIRINGI: ")).toBe(true);

    // Critical account events still go by e-mail.
    const s2 = new Date();
    await notify("company.suspended", [{ userId: owner.user.id }], { reason: "test" });
    expect((await msgs("company.suspended", s2)).some((m) => m.channel === "EMAIL" && m.status === "SENT")).toBe(true);
    await savePreferences(owner, { prefs: [{ category: "orders", channel: "EMAIL", enabled: true }], phone: "", smsConsent: false, whatsappConsent: false });
  });

  it("FIRINGI can change an event's channels and switch a channel off platform-wide", async () => {
    await expect(setChannelEnabled(await ctxFor(OPS), "EMAIL", false)).rejects.toThrow(); // Operations: view only
    const ops = await ctxFor(SA);
    await setEventChannels(ops, "order.new", []);
    let since = new Date();
    await notify("order.new", [{ companyId: await lxId() }], { number: "FO-X" });
    expect(await msgs("order.new", since)).toHaveLength(0); // in-app only
    await setEventChannels(ops, "order.new", null);
    await setChannelEnabled(ops, "EMAIL", false);
    since = new Date();
    await notify("order.new", [{ companyId: await lxId() }], { number: "FO-Y" });
    expect((await msgs("order.new", since)).some((m) => m.channel === "EMAIL")).toBe(false);
    await setChannelEnabled(ops, "EMAIL", true);
    await expect(setChannelEnabled(await ctxFor("owner@lisboacentral.test"), "EMAIL", false)).rejects.toThrow();
  });

  it("bell: unread count and mark as read", async () => {
    const owner = await ctxFor("owner@lisboacentral.test");
    expect(await unreadCount(owner)).toBeGreaterThan(0);
    await markRead(owner, "ALL");
    expect(await unreadCount(owner)).toBe(0);
  });
});

describe("language", () => {
  it("each recipient gets the message in their company country's language", async () => {
    const since = new Date();
    const kebab = await userId("owner@kebabhouse.test");
    const ib = await userId("owner@ibericas.test");
    await prisma.user.updateMany({ where: { id: { in: [kebab, ib] } }, data: { locale: null } });
    await notify("order.confirmed", [{ userId: kebab }], { number: "FO-PT", supplier: "Lisboa Central" });
    const lxOwner = await userId("owner@lisboacentral.test");
    await notify("order.new", [{ userId: lxOwner }], { number: "FO-EUR", buyer: "Kebab House", total: 1234.5 });
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: lxOwner, type: "order.new", createdAt: { gte: since } } })).body).toMatch(/1234,50\s€|1\s?234,50\s€/);
    await notify("restriction.approved", [{ userId: ib }], { restriction: "TOBACCO", until: "2027-12-31" });
    const pt = await prisma.notification.findFirstOrThrow({ where: { userId: kebab, createdAt: { gte: since } } });
    expect(pt.title).toBe("Encomenda FO-PT confirmada");
    const es = await prisma.notification.findFirstOrThrow({ where: { userId: ib, createdAt: { gte: since } } });
    expect(es.body).toBe("Su acceso a productos de tabaco está aprobado hasta el 2027-12-31.");
    const mail = await prisma.notificationMessage.findFirstOrThrow({ where: { userId: ib, channel: "EMAIL", createdAt: { gte: since } } });
    expect(mail.locale).toBe("es");
    expect(mail.subject).toBe("Acceso aprobado");
  });
});

describe("templates", () => {
  it("FIRINGI overrides a text per channel and language; placeholders are checked", async () => {
    const ops = await ctxFor(SA);
    await expect(saveTemplate(ops, { eventKey: "order.confirmed", channel: "EMAIL", locale: "en", subject: "x", body: "Hi {nope}", isActive: true })).rejects.toThrow(/Unknown placeholder/);
    await saveTemplate(ops, { eventKey: "order.confirmed", channel: "IN_APP", locale: "en", subject: "Yay {number}", body: "{supplier} said yes to {number}", isActive: true });
    const kebabOwner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@kebabhouse.test" } });
    await prisma.user.update({ where: { id: kebabOwner.id }, data: { locale: "en" } });
    const since = new Date();
    await notify("order.confirmed", [{ userId: kebabOwner.id }], { number: "FO-Z", supplier: "Lisboa Central" });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: kebabOwner.id, type: "order.confirmed", createdAt: { gte: since } } });
    expect(n.title).toBe("Yay FO-Z");
    expect(n.body).toBe("Lisboa Central said yes to FO-Z");
    await prisma.notificationTemplate.deleteMany({ where: { eventKey: "order.confirmed" } });
    await prisma.user.update({ where: { id: kebabOwner.id }, data: { locale: null } });
  });
});

describe("providers (mocked HTTP) and retries", () => {
  const driverUser = async () => {
    const id = await userId("driver@firingi.test");
    await prisma.user.update({ where: { id }, data: { phone: "+351930000001", smsConsentAt: new Date(), whatsappConsentAt: new Date() } });
    return id;
  };

  it("Twilio SMS: sent → id stored; 5xx → retry later; 4xx → permanent failure", async () => {
    Object.assign(process.env, { SMS_DRIVER: "twilio", TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_SMS_FROM: "+15550001111" });
    const id = await driverUser();
    const calls: { url: string; body: string; auth: string }[] = [];
    const ok: typeof fetch = async (url, init) => { calls.push({ url: String(url), body: String(init!.body), auth: String((init!.headers as Record<string, string>).authorization) }); return new Response(JSON.stringify({ sid: "SM-OK" }), { status: 201 }); };
    let since = new Date();
    await notify("delivery.assigned", [{ userId: id }], { number: "FO-1", customer: "Kebab House", address: "Rua X" }, { fetchImpl: ok });
    const sms = (await msgs("delivery.assigned", since)).find((m) => m.channel === "SMS")!;
    expect(sms.status).toBe("SENT");
    expect(sms.providerMessageId).toBe("SM-OK");
    expect(calls[0].url).toContain("/Accounts/AC123/Messages.json");
    expect(new URLSearchParams(calls[0].body).get("To")).toBe("+351930000001");
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("AC123:tok").toString("base64")}`);

    since = new Date();
    await notify("delivery.assigned", [{ userId: id }], { number: "FO-2" }, { fetchImpl: async () => new Response("{}", { status: 503 }) });
    const failed = (await msgs("delivery.assigned", since)).find((m) => m.channel === "SMS")!;
    expect(failed.status).toBe("FAILED");
    expect(failed.nextAttemptAt).not.toBeNull();
    await prisma.notificationMessage.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await processOutbox(50, ok);
    expect((await prisma.notificationMessage.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("SENT");

    since = new Date();
    await notify("delivery.assigned", [{ userId: id }], { number: "FO-3" }, { fetchImpl: async () => new Response(JSON.stringify({ message: "invalid number" }), { status: 400 }) });
    const bad = (await msgs("delivery.assigned", since)).find((m) => m.channel === "SMS")!;
    expect(bad.status).toBe("FAILED");
    expect(bad.nextAttemptAt).toBeNull();
    expect(bad.error).toMatch(/invalid number/);
    // Back office retry
    process.env.SMS_DRIVER = "log";
    expect((await retryMessage(await ctxFor(SA), bad.id))!.status).toBe("SENT");
  });

  it("Meta WhatsApp: approved template with the event's variables as parameters", async () => {
    Object.assign(process.env, { WHATSAPP_DRIVER: "meta", WHATSAPP_TOKEN: "EAAx", WHATSAPP_PHONE_NUMBER_ID: "1099" });
    const id = await driverUser();
    const ops = await ctxFor(SA);
    const driverLocale = "pt-PT"; // FIRINGI driver: Portuguese company, no personal language
    await saveTemplate(ops, { eventKey: "delivery.assigned", channel: "WHATSAPP", locale: driverLocale, body: "Nova entrega {number} para {customer}, {address}.", waTemplateName: "delivery_assigned", waLanguage: "pt_PT", isActive: true });
    let payload: { template?: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] }; to?: string } = {};
    const since = new Date();
    await notify("delivery.assigned", [{ userId: id }], { number: "FO-9", customer: "Kebab House", address: "Rua da Madalena 120" }, {
      fetchImpl: async (url, init) => { payload = JSON.parse(String(init!.body)); expect(String(url)).toContain("/1099/messages"); return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }); },
    });
    const wa = (await msgs("delivery.assigned", since)).find((m) => m.channel === "WHATSAPP")!;
    expect(wa.status).toBe("SENT");
    expect(payload.to).toBe("351930000001");
    expect(payload.template!.name).toBe("delivery_assigned");
    expect(payload.template!.language.code).toBe("pt_PT");
    expect(payload.template!.components[0].parameters.map((p) => p.text)).toEqual(["FO-9", "Kebab House", "Rua da Madalena 120"]);
    await prisma.notificationTemplate.deleteMany({ where: { eventKey: "delivery.assigned" } });

    // Delivery receipts update the log.
    await handleMeta({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "read" }] } }] }] });
    expect((await prisma.notificationMessage.findUniqueOrThrow({ where: { id: wa.id } })).status).toBe("READ");
  });
});

describe("webhooks and the inbound inbox", () => {
  it("signatures", () => {
    const params = { From: "+351930000001", Body: "Hi", MessageSid: "SM1" };
    const url = "https://firingi.example/api/webhooks/twilio";
    const sig = createHmac("sha1", "tok").update(url + "BodyHiFrom+351930000001MessageSidSM1").digest("base64");
    expect(twilioSignatureValid(url, params, sig, "tok")).toBe(true);
    expect(twilioSignatureValid(url, { ...params, Body: "Changed" }, sig, "tok")).toBe(false);
    const raw = '{"entry":[]}';
    expect(metaSignatureValid(raw, `sha256=${createHmac("sha256", "s3").update(raw).digest("hex")}`, "s3")).toBe(true);
    expect(metaSignatureValid(raw, "sha256=00", "s3")).toBe(false);
  });

  it("inbound WhatsApp is linked to the driver; replies only inside the 24-hour window", async () => {
    const ops = await ctxFor(OPS);
    await prisma.user.update({ where: { email: "driver@firingi.test" }, data: { phone: "+351930000001" } });
    await handleMeta({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.in.${tag}`, from: "351930000001", type: "text", text: { body: "Customer not answering the door" } }] } }] }] });
    await handleMeta({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.in.${tag}`, from: "351930000001", type: "text", text: { body: "dup" } }] } }] }] }); // provider retry
    const drivers = await inbox(ops, "DRIVER");
    const c = drivers.find((x) => x.from === "+351930000001")!;
    expect(c.user?.name).toBe("Daniel Motorista");
    expect(c.unhandled).toBe(1);
    expect((await conversation(ops, "+351930000001")).whatsappWindowOpen).toBe(true);
    const r = await reply(ops, "+351930000001", "WHATSAPP", "Call the shop on 213 000 000, please.");
    expect(r!.status).toBe("SENT");
    expect((await inbox(ops, "DRIVER")).find((x) => x.from === "+351930000001")!.unhandled).toBe(0);

    // Outside the window: free text refused.
    await prisma.inboundMessage.updateMany({ where: { from: "+351930000001" }, data: { receivedAt: new Date(Date.now() - 25 * 3600_000) } });
    await expect(reply(ops, "+351930000001", "WHATSAPP", "Hello?")).rejects.toThrow(/24 hours/);
    // SMS replies are always possible; an unknown number lands in the customer inbox.
    const stranger = `+3519${String(Date.now()).slice(-8)}`; // a number no user has
    await handleTwilio({ From: stranger, Body: "Do you deliver to Sintra?", MessageSid: `SM-in-${tag}` });
    expect((await inbox(ops, "CUSTOMER")).some((x) => x.from === stranger && x.user === null)).toBe(true);
  });
});
