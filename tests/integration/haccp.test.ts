/**
 * Phase 69: food safety logbook — a restaurant applies the template, records temperatures (out of range needs a
 * corrective action), checklists, cooling and a failed FIRINGI delivery (→ claim link); history, completion, the PDF
 * report, training, the job's late-check alert, AI tips, FIRINGI's overview and switches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as H from "@/server/haccp/service";
import { saveHaccpSettings } from "@/server/haccp/settings";
import { processHaccp } from "@/server/haccp/job";
import { renderHaccpPdf } from "@/server/pdf/haccp";
import { ctxFor } from "../helpers";

const KB = "owner@kebabhouse.test", ADMIN = "superadmin@firingi.test";
let kbId = "";
async function clean() {
  await prisma.setting.deleteMany({ where: { key: "haccp.settings" } });
  await prisma.haccpEntry.deleteMany({ where: { companyId: kbId } });
  await prisma.haccpUnit.deleteMany({ where: { companyId: kbId } });
  await prisma.haccpTask.deleteMany({ where: { companyId: kbId } });
  await prisma.haccpTraining.deleteMany({ where: { companyId: kbId } });
}
beforeAll(async () => { kbId = (await ctxFor(KB)).company.id; await clean(); });
afterAll(async () => { await clean(); });

describe("Food safety logbook", () => {
  it("a template sets up equipment and checklists (once)", async () => {
    const kb = await ctxFor(KB);
    expect((await H.today(kb)).setUp).toBe(false);
    const made = await H.applyTemplate(kb, "RESTAURANT", (k) => k.split(".").pop()!);
    expect(made).toBe(9);
    expect(await H.applyTemplate(kb, "RESTAURANT", (k) => k.split(".").pop()!)).toBe(0);
    const s = await H.setup(kb);
    expect(s.units.find((u) => u.name === "freezer1")?.limit).toBe("≤ −18 °C");
    expect(s.tasks.find((t) => t.name === "opening")?.items).toContain("handWash");
  });

  it("temperatures: in range, and out of range only with a corrective action", async () => {
    const kb = await ctxFor(KB);
    const u = (await H.setup(kb)).units.find((x) => x.name === "fridge1")!;
    expect((await H.logTemp(kb, { unitId: u.id, slot: "09:00", valueC: 3.5 })).ok).toBe(true);
    await expect(H.logTemp(kb, { unitId: u.id, slot: "17:00", valueC: 9 })).rejects.toThrow(/corrective/);
    const e = await H.logTemp(kb, { unitId: u.id, slot: "17:00", valueC: 9, corrective: "Moved food to fridge 2, called the technician" });
    expect(e.ok).toBe(false);
    const t = await H.today(kb);
    const row = t.units.find((x) => x.id === u.id)!;
    expect(row.slots.map((x) => x.state)).toEqual(["DONE", "OUT"]);
    expect(t.issues[0].corrective).toMatch(/technician/);
  });

  it("checklists, cooling and a failed FIRINGI delivery (→ claim)", async () => {
    const kb = await ctxFor(KB);
    const task = (await H.setup(kb)).tasks.find((x) => x.name === "opening")!;
    await expect(H.logTask(kb, { taskId: task.id, results: { handWash: true } })).rejects.toThrow(/corrective/);
    expect((await H.logTask(kb, { taskId: task.id, results: Object.fromEntries(task.items.map((i) => [i, true])) })).ok).toBe(true);
    expect((await H.logCooling(kb, { product: "Rice", startC: 70, endC: 8, minutes: 100 })).ok).toBe(true);
    await expect(H.logCooling(kb, { product: "Chicken", startC: 75, endC: 14, minutes: 130 })).rejects.toThrow(/corrective/);
    const order = await prisma.order.findFirst({ where: { buyerCompanyId: kbId }, select: { id: true } });
    if (order) {
      const r = await H.logDelivery(kb, { orderId: order.id, product: "Chicken", valueC: 9, packagingOk: true, datesOk: true, corrective: "Refused the chicken" });
      expect(r.entry.ok).toBe(false);
      expect(r.claimUrl).toBe(`/buy/orders/${order.id}/claim`);
    }
    const ok = await H.logDelivery(kb, { supplier: "Local bakery", product: "Bread", packagingOk: true, datesOk: true });
    expect(ok.entry.ok).toBe(true);
    expect((await H.today(kb)).tasks.find((x) => x.id === task.id)?.done?.ok).toBe(true);
  });

  it("history, report and PDF", async () => {
    const kb = await ctxFor(KB);
    const now = new Date();
    const all = await H.history(kb, { from: now, to: now });
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect((await H.history(kb, { from: now, to: now, issues: true })).every((e) => !e.ok)).toBe(true);
    const r = await H.reportData(kb, now, now);
    expect(r.units.find((u) => u.name === "fridge1")?.readings).toHaveLength(2);
    expect(r.corrective.length).toBeGreaterThanOrEqual(1);
    const pdf = await renderHaccpPdf(r);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("training: expiring soon → tip and the job's alert; late checks → one alert a day", async () => {
    const kb = await ctxFor(KB);
    const soon = new Date(Date.now() + 10 * 86400_000);
    await H.saveTraining(kb, null, { personName: "Karim", course: "Food hygiene level 2", issuedAt: new Date(Date.now() - 300 * 86400_000), expiresAt: soon });
    expect((await H.trainings(kb))[0].state).toBe("SOON");
    expect((await H.today(kb)).tips.map((t) => t.code)).toContain("TRAINING_EXPIRING");
    const late = new Date(); late.setUTCHours(23, 0, 0, 0);
    const r = await processHaccp(late);
    expect(r.trainingAlerts).toBe(1);
    expect(r.missedAlerts).toBeGreaterThanOrEqual(1);
    expect((await processHaccp(late)).missedAlerts).toBe(0); // once a day
  });

  it("taking back an entry; FIRINGI's overview; switches", async () => {
    const kb = await ctxFor(KB), admin = await ctxFor(ADMIN);
    const e = (await H.history(kb, { from: new Date(), to: new Date() }))[0];
    await H.deleteEntry(kb, e.id);
    expect(await prisma.haccpEntry.findUnique({ where: { id: e.id } })).toBeNull();
    const o = await H.adminOverview(admin);
    expect(o.businesses).toBeGreaterThanOrEqual(1);
    expect((await H.adminBusinesses(admin)).find((b) => b.id === kbId)?.units).toBe(4);
    await saveHaccpSettings(admin, { audiences: { customers: false, wholesalers: true } });
    await expect(H.today(kb)).rejects.toThrow(/switched/);
    await saveHaccpSettings(admin, { audiences: { customers: true, wholesalers: true }, parts: { ...(await import("@/server/haccp/settings")).DEFAULT_HACCP.parts, cooling: false } });
    await expect(H.logCooling(kb, { product: "Soup", startC: 80, endC: 5, minutes: 60 })).rejects.toThrow(/switched off/);
  });
});
