/**
 * Phase 68: Services & used cooking oil — a distributor applies to provide oil collection and pest control, FIRINGI
 * approves; a restaurant takes pest control every month (visits planned) and an "only when requested" oil plan; its
 * fryer log fills the containers and a collection is asked for by itself; the provider records it (FIRINGI invoices:
 * buy-back to the customer, the provider's amount) and a pest visit it invoices itself (FIRINGI's commission, invoiced
 * monthly); the customer never sees commission or the provider's amount; documents; missed visits; the switches; AI.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as Cat from "@/server/servicing/catalogue";
import * as Plans from "@/server/servicing/plans";
import * as Oil from "@/server/servicing/oil";
import { saveServicesSettings } from "@/server/servicing/settings";
import { processServices } from "@/server/servicing/job";
import { serviceRecommendations } from "@/server/servicing/ai";
import { renderVisitPdf } from "@/server/pdf/service-visit";
import { ctxFor } from "../helpers";

const AT = "owner@atlantico.test", KB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ADMIN = "superadmin@firingi.test";
const DAY = 86400_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
let oilId = "", pestId = "", kbId = "", atId = "";

async function clean() {
  await prisma.setting.deleteMany({ where: { key: "services.settings" } });
  await prisma.fryerLog.deleteMany({});
  await prisma.fryer.deleteMany({});
  await prisma.printJob.deleteMany({});
  await prisma.printProduct.deleteMany({});
  await prisma.serviceVisit.deleteMany({});
  await prisma.servicePlan.deleteMany({});
  await prisma.serviceProvider.deleteMany({});
}

beforeAll(async () => {
  await clean();
  await Cat.ensureBuiltIns();
  oilId = (await prisma.serviceType.findUniqueOrThrow({ where: { code: "OIL_COLLECTION" } })).id;
  pestId = (await prisma.serviceType.findUniqueOrThrow({ where: { code: "PEST_CONTROL" } })).id;
  kbId = (await ctxFor(KB)).company.id;
  atId = (await ctxFor(AT)).company.id;
});
afterAll(async () => { await clean(); });

describe("Services & used oil", () => {
  it("a supplier applies, FIRINGI approves (who invoices: per service, or the provider's own)", async () => {
    const at = await ctxFor(AT), admin = await ctxFor(ADMIN);
    await expect(Cat.applyProvider(at, { serviceTypeId: oilId, countries: ["PT"] })).rejects.toThrow(/licence/);
    const oilP = await Cat.applyProvider(at, { serviceTypeId: oilId, countries: ["PT"], licenceNumber: "APA-123", licenceExpiresAt: new Date(Date.now() + 400 * DAY) });
    const pestP = await Cat.applyProvider(at, { serviceTypeId: pestId, countries: ["PT"], licenceNumber: "DGAV-9" });
    expect(oilP.status).toBe("PENDING");
    // no provider approved yet → the customer can't take it
    await expect(Plans.subscribe(await ctxFor(KB), { serviceTypeId: oilId, frequency: "ON_REQUEST", weekday: 1, dayA: 1, dayB: 15, timeWindow: "ANY" })).rejects.toThrow(/No provider/);
    await Cat.decideProvider(admin, oilP.id, { approve: true });
    await Cat.decideProvider(admin, pestP.id, { approve: true, commissionPct: 20 });
    const list = await Cat.listProviders(at);
    expect(list.find((p) => p.serviceTypeId === oilId)?.pricing.invoicedBy).toBe("FIRINGI");
    const pest = list.find((p) => p.serviceTypeId === pestId)!;
    expect(pest.pricing.invoicedBy).toBe("PROVIDER");
    expect(pest.pricing.commissionPct).toBe(20);
  });

  it("the customer takes pest control monthly (visits planned) and oil on request; no commission is shown", async () => {
    const kb = await ctxFor(KB);
    const pest = await Plans.subscribe(kb, { serviceTypeId: pestId, frequency: "MONTHLY", weekday: 1, dayA: 10, dayB: 25, timeWindow: "MORNING" });
    const visits = await prisma.serviceVisit.findMany({ where: { planId: pest.id } });
    expect(visits.length).toBeGreaterThanOrEqual(1);
    expect(visits.every((v) => v.date.getUTCDate() === 10 && v.status === "SCHEDULED")).toBe(true);
    await expect(Plans.subscribe(kb, { serviceTypeId: pestId, frequency: "MONTHLY", weekday: 1, dayA: 10, dayB: 25, timeWindow: "ANY" })).rejects.toThrow(/already/);
    await expect(Plans.subscribe(kb, { serviceTypeId: oilId, frequency: "WEEKLY", weekday: 9, dayA: 1, dayB: 1, timeWindow: "NOON" })).rejects.toThrow(/time/);
    await Plans.subscribe(kb, { serviceTypeId: oilId, frequency: "ON_REQUEST", weekday: 1, dayA: 1, dayB: 15, timeWindow: "ANY", containers: 2, containerLitres: 50, autoRequestWhenFull: true });
    const mine = await Plans.myServices(kb);
    expect(mine.plans).toHaveLength(2);
    const json = JSON.stringify(mine);
    expect(json).not.toMatch(/commission|providerAmount|providerPer/i);
    expect(mine.types.find((t) => t.code === "OIL_COLLECTION")?.buybackPerUnit).toBe(0.2);
  });

  it("the fryer log fills the containers and a collection is asked for by itself", async () => {
    const kb = await ctxFor(KB);
    const f = await Oil.saveFryer(kb, null, { name: "Fryer 1", capacityL: 25, oilCostPerL: 2.1 });
    await Oil.logFryer(kb, f.id, { kind: "TEST", polarPct: 25 });
    expect((await Oil.oilSummary(kb)).fryers[0].status).toBe("CHANGE");
    await Oil.logFryer(kb, f.id, { kind: "CHANGE", litres: 50 });
    expect(await prisma.serviceVisit.count({ where: { customerCompanyId: kbId, serviceTypeId: oilId } })).toBe(0); // 50 of 100 L
    await Oil.logFryer(kb, f.id, { kind: "CHANGE", litres: 40 });
    const req = await prisma.serviceVisit.findFirstOrThrow({ where: { customerCompanyId: kbId, serviceTypeId: oilId } });
    expect(req.origin).toBe("REQUESTED");
    expect(req.requestReason).toBe("CONTAINER_FULL");
    const sum = await Oil.oilSummary(kb);
    expect(sum.storage.pct).toBe(90);
    expect(sum.insights.map((i) => i.code)).toContain("FULL");
    expect(sum.totals.cost30).toBeCloseTo(189, 1);
    // asking again while one is open is refused
    await expect(Plans.requestVisit(kb, { serviceTypeId: oilId, reason: "CUSTOMER" })).rejects.toThrow(/already open/);
  });

  it("the provider records the collection: FIRINGI invoices — buy-back to the customer, the provider's amount", async () => {
    const at = await ctxFor(AT);
    const board = await Plans.providerBoard(at);
    const req = board.requests[0];
    expect(req.customer).toMatch(/Kebab/);
    await Plans.confirmVisit(at, req.id);
    await expect(Plans.completeVisit(at, req.id, { quantity: 95 })).rejects.toThrow(/signed/);
    const v = await Plans.completeVisit(at, req.id, { quantity: 95, containersTaken: 2, containersLeft: 2, signedBy: "Karim", docNumber: "EGAR-2026-001" });
    expect(v.status).toBe("DONE");
    expect(v.invoicedBy).toBe("FIRINGI");
    expect(n(v.buybackNet)).toBe(19);
    expect(n(v.providerAmount)).toBe(4.75);
    expect(n(v.commissionNet)).toBe(0);
    expect(v.invoiceId).toBeNull(); // nothing to charge the customer
    expect((await Oil.oilSummary(await ctxFor(KB))).storage.litres).toBe(0);
  });

  it("a pest visit the provider invoices itself: its invoice number is needed; FIRINGI earns a commission", async () => {
    const at = await ctxFor(AT);
    const visit = (await Plans.providerBoard(at)).upcoming.find((x) => x.serviceTypeId === pestId)!;
    await expect(Plans.completeVisit(at, visit.id, {})).rejects.toThrow(/future|invoice/);
    await Plans.moveVisit(at, visit.id, new Date());
    await expect(Plans.completeVisit(at, visit.id, { signedBy: "Karim" })).rejects.toThrow(/invoice number/);
    const v = await Plans.completeVisit(at, visit.id, { signedBy: "Karim", providerInvoiceNo: "FT 2026/77" });
    expect(v.invoicedBy).toBe("PROVIDER");
    expect(n(v.feeNet)).toBe(45);
    expect(n(v.commissionNet)).toBe(9); // 20 % for this provider
    expect(n(v.providerAmount)).toBe(0);
  });

  it("money: open amounts, paid, commission invoiced to the provider", async () => {
    const admin = await ctxFor(ADMIN);
    const m = await Plans.moneyOpen();
    expect(m.buyback).toBe(19);
    expect(m.provider).toBe(4.75);
    expect(m.commission).toBe(9);
    const buy = m.rows.filter((r) => n(r.buybackNet) > 0).map((r) => r.id);
    expect(await Plans.markPaid(admin, buy, "BUYBACK")).toBe(1);
    expect(await Plans.invoiceCommissions(admin.user.id, new Date(Date.now() + DAY))).toBe(1);
    const done = await prisma.serviceVisit.findFirstOrThrow({ where: { serviceTypeId: pestId, status: "DONE" } });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: done.commissionInvoiceId! } });
    expect(inv.recipientCompanyId).toBe(atId);
    expect((await Plans.moneyOpen()).commission).toBe(0);
  });

  it("documents: the customer and the provider, nobody else", async () => {
    const v = await prisma.serviceVisit.findFirstOrThrow({ where: { serviceTypeId: oilId, status: "DONE" } });
    const d = await Plans.visitDocument(await ctxFor(KB), v.id);
    expect(d.wasteCode).toBe("20 01 25");
    expect(d.docNumber).toBe("EGAR-2026-001");
    expect(d.provider.licence).toBe("APA-123");
    const pdf = await renderVisitPdf(d);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
    await expect(Plans.visitDocument(await ctxFor(LX), v.id)).rejects.toThrow();
  });

  it("the job marks unrecorded visits missed; AI suggests a follow-up; skip; switches", async () => {
    const kb = await ctxFor(KB);
    const plan = await prisma.servicePlan.findFirstOrThrow({ where: { customerCompanyId: kbId, serviceTypeId: pestId } });
    const old = await prisma.serviceVisit.create({ data: { number: "SV-TEST-OLD", planId: plan.id, customerCompanyId: kbId, serviceTypeId: pestId, providerId: plan.providerId, origin: "REQUESTED", status: "CONFIRMED", date: new Date(Date.now() - 4 * DAY) } });
    const r = await processServices();
    expect(r.missed).toBeGreaterThanOrEqual(1);
    expect((await prisma.serviceVisit.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("MISSED");
    const recs = await serviceRecommendations();
    expect(recs.some((x) => x.kind === "SERVICE_MISSED" && x.subjectId === kbId)).toBe(true);
    const next = (await Plans.myServices(kb)).upcoming.find((v) => v.serviceTypeId === pestId && v.status === "SCHEDULED");
    if (next) { await Plans.skipVisit(kb, next.id); expect((await prisma.serviceVisit.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("SKIPPED"); }
    // FIRINGI switches services off for customers → the customer can't use them
    await saveServicesSettings(await ctxFor(ADMIN), { audiences: { customers: false, wholesalers: true } });
    await expect(Plans.myServices(kb)).rejects.toThrow(/switched/);
    await saveServicesSettings(await ctxFor(ADMIN), { audiences: { customers: true, wholesalers: true } });
    await expect(Plans.myServices(kb)).resolves.toBeTruthy();
  });
});
