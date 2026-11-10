/**
 * Phase 13: CRM & Sales and customer support.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  account360, convertLead, convertMatchingLeads, createDeal, createLead, createTask, listAccounts, listActivities, listLeads, listTasks, logActivity, moveDeal, pipeline, saveContact, setAccount, setTaskStatus, updateLead,
} from "@/server/services/crm";
import { customerActivity, listSegments, salesPerformance, saveSegment, segmentMembers } from "@/server/services/crm-insights";
import { listTickets, openTicket, replyTicket, ticketDetail, updateTicket } from "@/server/services/support";
import { addToCart, clearCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { ctxFor, makeApprovedCompany } from "../helpers";

const SALES = "sales@firingi.test";
const SUPPORT = "support@firingi.test";
const OPS = "ops@firingi.test";
const KEBAB = "owner@kebabhouse.test";
const tag = Date.now().toString(36);
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
const notes = (email: string, type: string) => prisma.notification.count({ where: { user: { email }, type } });

afterAll(() => prisma.$disconnect());

/** Kebab House places an order with Lisboa Central (so it has recent spend). */
beforeAll(async () => {
  const kebab = await ctxFor(KEBAB);
  const lx = await ctxFor("owner@lisboacentral.test");
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await clearCart(kebab);
  await addToCart(kebab, offer.id, 20);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  await placeOrder(kebab, { deliveryAddressId: addr.id });
});

describe("leads", () => {
  it("sales creates a lead; first contact moves it on; lost needs a reason; support can only look", async () => {
    const sales = await ctxFor(SALES);
    const lead = await createLead(sales, { companyName: `Café Central ${tag}`, contactName: "Rita", email: `rita.${tag}@cafe.test`, countryCode: "PT", city: "Lisboa", kind: "CUSTOMER", source: "FIELD_VISIT", estimatedMonthlyNet: 1200 });
    expect(lead.number).toMatch(/^LD-\d{4}-\d{6}$/);
    expect(lead.ownerId).toBe(sales.user.id);
    expect(await prisma.crmContact.count({ where: { leadId: lead.id, isPrimary: true } })).toBe(1);
    await expect(createLead(await ctxFor(SUPPORT), { companyName: "X", email: "x@x.test", countryCode: "PT", kind: "CUSTOMER" })).rejects.toThrow();
    expect((await listLeads(await ctxFor(SUPPORT), { status: "OPEN" })).some((l) => l.id === lead.id)).toBe(true);
    await expect(createLead(sales, { companyName: "No contact", countryCode: "PT", kind: "CUSTOMER" })).rejects.toThrow(/e-mail or a phone/);

    await logActivity(sales, { kind: "CALL", subject: "Intro call", body: "Interested in weekly drinks", leadId: lead.id });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CONTACTED");
    await expect(updateLead(sales, lead.id, { status: "LOST" })).rejects.toThrow(/why/);
    await updateLead(sales, lead.id, { status: "QUALIFIED" });

    // Assigning the lead to a teammate tells them.
    const before = await notes(OPS, "crm.task_assigned");
    await updateLead(sales, lead.id, { ownerId: await userId(OPS) });
    expect(await notes(OPS, "crm.task_assigned")).toBe(before + 1);
  });

  it("a lead converts automatically when its company is approved (same e-mail); history moves to the account", async () => {
    const sales = await ctxFor(SALES);
    const fixture = await makeApprovedCompany("CUSTOMER");
    const lead = await createLead(sales, { companyName: `Snack Bar ${tag}`, email: fixture.email.toUpperCase(), countryCode: "PT", kind: "CUSTOMER" });
    await logActivity(sales, { kind: "VISIT", subject: "Visited the shop", leadId: lead.id });
    const deal = await createDeal(sales, { title: "First orders", leadId: lead.id, valueNet: 800 });
    expect(await convertMatchingLeads(fixture.companyId)).toBe(1);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([l.status, l.convertedCompanyId]).toEqual(["CONVERTED", fixture.companyId]);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).companyId).toBe(fixture.companyId);
    const acc = await account360(sales, fixture.companyId);
    expect(acc.company.crmActivities.some((a) => a.subject === "Visited the shop")).toBe(true);
    expect(acc.company.crmAccount?.ownerId).toBe(sales.user.id); // lead owner → account manager
    await expect(updateLead(sales, lead.id, { status: "LOST", lostReason: "x" })).rejects.toThrow(/already a customer/);
  });

  it("a lead can be linked to an existing company by hand", async () => {
    const sales = await ctxFor(SALES);
    const fixture = await makeApprovedCompany("WHOLESALER");
    const lead = await createLead(sales, { companyName: `Grossista ${tag}`, phone: "+351 910 000 000", countryCode: "PT", kind: "WHOLESALER" });
    await convertLead(sales, lead.id, fixture.companyId);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CONVERTED");
  });
});

describe("accounts, contacts, pipeline, tasks", () => {
  it("account manager, tier and tags; 90-day spend; contacts with one primary", async () => {
    const sales = await ctxFor(SALES);
    const kebab = await ctxFor(KEBAB);
    await setAccount(sales, kebab.company.id, { ownerId: sales.user.id, tier: "A", tags: ["Kebab", " lisboa ", "kebab"] });
    await expect(setAccount(sales, kebab.company.id, { tier: "Z" })).rejects.toThrow(/Tier/);
    const row = (await listAccounts(sales, { tag: "kebab" })).find((a) => a.id === kebab.company.id)!;
    expect(row.crmAccount).toMatchObject({ tier: "A", tags: ["kebab", "lisboa"] });
    expect(row.bought90).toBeGreaterThan(0);
    const a = await saveContact(sales, null, { companyId: kebab.company.id, name: "Ahmed", jobTitle: "Manager", phone: "+351 912 345 678", isPrimary: true });
    const b = await saveContact(sales, null, { companyId: kebab.company.id, name: "Fatima", isPrimary: true });
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: a.id } })).isPrimary).toBe(false);
    expect((await prisma.crmContact.findUniqueOrThrow({ where: { id: b.id } })).isPrimary).toBe(true);
    const acc = await account360(sales, kebab.company.id);
    expect(acc.totals.n90).toBeGreaterThan(0);
  });

  it("deals move through the pipeline; lost needs a reason; weighted value follows the stage", async () => {
    const sales = await ctxFor(SALES);
    const kebab = await ctxFor(KEBAB);
    const d = await createDeal(sales, { title: `Weekly drinks ${tag}`, companyId: kebab.company.id, valueNet: 2000 });
    expect(d.number).toMatch(/^DL-/);
    await moveDeal(sales, d.id, "PROPOSAL");
    const p = await pipeline(sales);
    const col = p.find((c) => c.stage === "PROPOSAL")!;
    expect(col.deals.some((x) => x.id === d.id)).toBe(true);
    expect(col.weighted).toBeGreaterThanOrEqual(1000); // 50 %
    await expect(moveDeal(sales, d.id, "LOST")).rejects.toThrow(/why/);
    await moveDeal(sales, d.id, "WON");
    const won = await prisma.deal.findUniqueOrThrow({ where: { id: d.id } });
    expect([won.probability, won.closedAt !== null]).toEqual([100, true]);
    await expect(createDeal(await ctxFor(SUPPORT), { title: "x", companyId: kebab.company.id, valueNet: 1 })).rejects.toThrow();
  });

  it("follow-ups and tasks: assigned to a teammate (notified), done by the assignee; notes vs communications", async () => {
    const sales = await ctxFor(SALES);
    const kebab = await ctxFor(KEBAB);
    await expect(createTask(sales, { kind: "FOLLOW_UP", title: "Call back", dueAt: new Date() })).rejects.toThrow(/about a company/);
    const before = await notes(SUPPORT, "crm.task_assigned");
    const t = await createTask(sales, { kind: "FOLLOW_UP", title: `Call Kebab House about the new menu ${tag}`, dueAt: new Date(Date.now() - 3600_000), assigneeId: await userId(SUPPORT), companyId: kebab.company.id });
    expect(await notes(SUPPORT, "crm.task_assigned")).toBe(before + 1);
    const supportCtx = await ctxFor(SUPPORT);
    expect((await listTasks(supportCtx, { kind: "FOLLOW_UP", assigneeId: supportCtx.user.id, overdue: true })).some((x) => x.id === t.id)).toBe(true);
    await setTaskStatus(supportCtx, t.id, "DONE"); // own task: allowed with view rights
    expect((await prisma.crmTask.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("DONE");

    await logActivity(sales, { kind: "NOTE", subject: `Prefers deliveries before 11:00 ${tag}`, companyId: kebab.company.id });
    await logActivity(sales, { kind: "WHATSAPP", subject: `Sent the price list ${tag}`, companyId: kebab.company.id });
    const notesList = await listActivities(sales, { notes: true, q: tag });
    const comms = await listActivities(sales, { q: tag });
    expect(notesList.every((a) => a.kind === "NOTE") && notesList.length >= 1).toBe(true);
    expect(comms.every((a) => a.kind !== "NOTE") && comms.some((a) => a.kind === "WHATSAPP")).toBe(true);
    await expect(logActivity(sales, { kind: "CALL", subject: "Later", companyId: kebab.company.id, at: new Date(Date.now() + 86400_000) })).rejects.toThrow(/future/);
  });
});

describe("insights", () => {
  it("customer activity, segments and sales performance", async () => {
    const sales = await ctxFor(SALES);
    const kebab = await ctxFor(KEBAB);
    const rows = await customerActivity(sales);
    const k = rows.find((r) => r.id === kebab.company.id)!;
    expect(["ACTIVE", "NEW"]).toContain(k.status);
    expect(k.orders90).toBeGreaterThan(0);
    const never = await makeApprovedCompany("CUSTOMER");
    expect((await customerActivity(sales)).find((r) => r.id === never.companyId)!.status).toBe("NEVER_ORDERED");

    const seg = await saveSegment(sales, null, { name: `Tier A buyers ${tag}`, rules: { types: ["CUSTOMER"], tiers: ["A"], statuses: ["ACTIVE", "NEW"], minSpend90: 1 } });
    const members = await segmentMembers(sales, seg.id);
    expect(members.map((m) => m.id)).toContain(kebab.company.id);
    expect(members.map((m) => m.id)).not.toContain(never.companyId);
    expect((await listSegments(sales)).find((s) => s.id === seg.id)!.count).toBe(members.length);
    await expect(saveSegment(sales, null, { name: "Bad", rules: { minSpend90: 10, maxSpend90: 5 } })).rejects.toThrow(/above/);

    const perf = await salesPerformance(sales, { from: new Date(Date.now() - 30 * 86400_000), to: new Date() });
    const me = perf.find((p) => p.id === sales.user.id)!;
    expect(me.leadsNew).toBeGreaterThanOrEqual(2); // the first lead was handed to operations
    expect(me.dealsWon).toBeGreaterThanOrEqual(1);
    expect(me.activities).toBeGreaterThanOrEqual(2);
    expect(me.accounts).toBeGreaterThanOrEqual(1);
  });
});

describe("support tickets", () => {
  it("customer asks, staff answers (internal notes hidden), customer replies, resolved; others can't see it", async () => {
    const kebab = await ctxFor(KEBAB);
    const order = await prisma.order.findFirstOrThrow({ where: { buyerCompanyId: kebab.company.id }, orderBy: { placedAt: "desc" } });
    const staffBefore = await notes(SUPPORT, "support.new");
    await expect(openTicket(kebab, { subject: "x", body: "help", category: "OTHER" })).rejects.toThrow(/subject/);
    const t = await openTicket(kebab, { subject: `Missing box of cola ${tag}`, body: "One box of cola was missing in today's delivery.", category: "DELIVERY", orderId: order.id });
    expect([t.number.slice(0, 3), t.priority, t.status]).toEqual(["TK-", "HIGH", "OPEN"]);
    expect(await notes(SUPPORT, "support.new")).toBe(staffBefore + 1);

    const support = await ctxFor(SUPPORT);
    await replyTicket(support, t.id, { body: "Checked with the driver: box left at the depot.", internal: true });
    const custBefore = await notes(KEBAB, "support.reply");
    await replyTicket(support, t.id, { body: "Sorry! We bring the box tomorrow morning." });
    const afterStaff = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
    expect([afterStaff.status, afterStaff.assigneeId]).toEqual(["PENDING_CUSTOMER", support.user.id]);
    expect(await notes(KEBAB, "support.reply")).toBe(custBefore + 1);

    const seen = await ticketDetail(kebab, t.id);
    expect(seen.ticket.messages.map((m) => m.body)).not.toContain("Checked with the driver: box left at the depot.");
    expect(seen.ticket.messages).toHaveLength(2);
    expect((await ticketDetail(support, t.id)).ticket.messages).toHaveLength(3);

    await replyTicket(kebab, t.id, { body: "Thank you, before 11 please." });
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("OPEN");
    await updateTicket(support, t.id, { status: "RESOLVED", priority: "NORMAL" });
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("RESOLVED");
    expect(await notes(KEBAB, "support.resolved")).toBeGreaterThanOrEqual(1);

    // Another company can't open it; the customer only lists its own tickets; sales can read, not answer.
    const lx = await ctxFor("owner@lisboacentral.test");
    await expect(ticketDetail(lx, t.id)).rejects.toThrow(/not found/i);
    expect((await listTickets(lx)).some((x) => x.id === t.id)).toBe(false);
    expect((await listTickets(kebab)).some((x) => x.id === t.id)).toBe(true);
    expect((await listTickets(support, { status: "RESOLVED", q: tag })).map((x) => x.id)).toContain(t.id);
    const finance = await ctxFor("finance@firingi.test");
    await expect(replyTicket(finance, t.id, { body: "hi" })).rejects.toThrow();
  });

  it("a supplier can open a ticket too; an order of someone else is refused", async () => {
    const lx = await ctxFor("owner@lisboacentral.test");
    const other = await prisma.order.findFirst({ where: { buyerCompanyId: { not: lx.company.id }, sellerCompanyId: { not: lx.company.id } } });
    if (other) await expect(openTicket(lx, { subject: "About an order", body: "Please check this", category: "ORDER", orderId: other.id })).rejects.toThrow(/your orders/);
    const t = await openTicket(lx, { subject: `Invoice question ${tag}`, body: "Our statement total looks different.", category: "INVOICE" });
    expect(t.priority).toBe("NORMAL");
  });
});
