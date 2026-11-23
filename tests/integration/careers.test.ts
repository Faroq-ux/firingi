/** Footer pages (FIRINGI only): FIRINGI saves pages and openings; a visitor applies; FIRINGI changes status and deletes; switched off. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as C from "@/server/landing/careers";
import { landingSettings, saveLandingSettings } from "@/server/landing/service";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
const apply = (o: Partial<Parameters<typeof C.submitApplication>[0]> = {}) =>
  C.submitApplication({ jobId: "driver-porto", name: "Ana Silva", email: "Ana@Example.com", phone: "+351 912 000 000", link: "https://www.linkedin.com/in/ana", message: "I love logistics.", consent: true, website: "", startedAt: Date.now() - 10_000, ...o }, { ip: `10.0.0.${Math.floor(Math.random() * 200)}`, locale: "pt-PT" });

beforeAll(async () => { await prisma.setting.deleteMany({ where: { key: "landing.settings" } }); await prisma.jobApplication.deleteMany({}); });
afterAll(async () => { await prisma.setting.deleteMany({ where: { key: "landing.settings" } }); await prisma.jobApplication.deleteMany({}); });

describe("Sustainability & careers", () => {
  it("starting texts in the visitor's language until FIRINGI writes its own", async () => {
    const pt = await C.aboutPage("sustainability", "pt-PT");
    const en = await C.aboutPage("sustainability", "en");
    expect(pt.on).toBe(true);
    expect(en.text).toMatch(/food waste/);
    expect(pt.text.length).toBeGreaterThan(100);
    await C.saveAboutSettings(await ctxFor(SA), { about: { sustainability: { on: true, text: { en: "Our own words." } }, careers: { on: true, text: {} } }, jobs: [{ id: "driver-porto", title: "Driver", location: "Porto", type: "FULL_TIME", text: "Drive our vans.", on: true }, { id: "hidden", title: "Hidden", location: "", type: "PART_TIME", text: "", on: false }], careersEmail: "jobs@firingi.test" });
    expect((await C.aboutPage("sustainability", "en")).text).toBe("Our own words.");
    expect((await C.aboutPage("sustainability", "de")).text).toBe("Our own words."); // English when no German text
    expect((await C.aboutPage("careers", "en")).jobs.map((j) => j.id)).toEqual(["driver-porto"]);
  });

  it("the main landing form keeps the pages and openings", async () => {
    const s = await landingSettings();
    const { about: _a, jobs: _j, careersEmail: _c, ...rest } = s;
    void _a; void _j; void _c;
    await saveLandingSettings(await ctxFor(SA), rest as never);
    const after = await landingSettings();
    expect(after.jobs.length).toBe(2);
    expect(after.about.sustainability.text.en).toBe("Our own words.");
  });

  it("a visitor applies; FIRINGI changes the status and deletes it (GDPR)", async () => {
    expect(await apply()).toEqual({ ok: true });
    expect(await apply({ jobId: "", link: "" })).toEqual({ ok: true }); // open application
    expect(await apply({ link: "ftp://x" })).toEqual({ ok: false, problem: "LINK" });
    expect(await apply({ consent: false })).toEqual({ ok: false, problem: "CONSENT" });
    expect(await apply({ jobId: "hidden" }).then(async () => (await prisma.jobApplication.findFirst({ orderBy: { createdAt: "desc" } }))?.jobId)).toBe(""); // a hidden opening counts as open application
    const admin = await ctxFor(SA);
    const list = await C.applications(admin);
    expect(list.rows.length).toBe(3);
    const a = list.rows.find((r) => r.jobId === "driver-porto")!;
    expect(a.email).toBe("ana@example.com");
    expect(a.jobTitle).toBe("Driver");
    expect(a.consentText.length).toBeGreaterThan(20);
    await C.setApplicationStatus(admin, a.id, "REVIEWING");
    expect((await C.applications(admin, { status: "REVIEWING" })).rows.length).toBe(1);
    await C.deleteApplication(admin, a.id);
    expect(await prisma.jobApplication.findUnique({ where: { id: a.id } })).toBeNull();
    await expect(C.applications(await ctxFor("owner@kebabhouse.test"))).rejects.toThrow();
  });

  it("careers off → page off, no applications; footer links follow", async () => {
    const s = await landingSettings();
    await C.saveAboutSettings(await ctxFor(SA), { about: { ...s.about, careers: { ...s.about.careers, on: false } }, jobs: s.jobs, careersEmail: s.careersEmail });
    expect((await C.aboutPage("careers", "en")).on).toBe(false);
    expect(await apply()).toEqual({ ok: false, problem: "OFF" });
    expect(await C.aboutLinks()).toEqual({ sustainability: true, careers: false });
  });
});
