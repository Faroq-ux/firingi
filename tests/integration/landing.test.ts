/**
 * Phase 56: the landing page — FIRINGI's settings (checked, legal date stamped, staff only), a visitor's question and
 * a vendor application becoming CRM leads (same e-mail → same open lead), spam and rate limits, the newsletter's
 * double opt-in (confirm, leave, export only confirmed), the country found from the browser, and the legal fallback.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as L from "@/server/landing/service";
import { DEFAULT_LANDING, type ContactIn } from "@/lib/landing";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", BUYER = "owner@kebabhouse.test";
const T0 = 1_900_000_000_000;
const stamp = `${Date.now()}`;
const mail = (n: string) => `p56-${n}-${stamp}@example.test`;
let ipN = 0;
const visitor = () => ({ ip: `10.56.${Math.floor(++ipN / 250)}.${ipN % 250}`, locale: "en", acceptLanguage: "pt-PT,pt;q=0.9" });
const msg = (p: Partial<ContactIn> = {}): ContactIn => ({ kind: "QUESTION", name: "Ana Silva", company: "Café Ana", email: mail("q"), phone: "+351 912 000 000", nif: "", type: "Café", message: "Do you deliver to Porto?", consent: true, website: "", startedAt: T0 - 10_000, ...p });

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { email: { contains: `-${stamp}@` } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await prisma.crmActivity.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.crmContact.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  await prisma.newsletterSubscriber.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
}
let saved: unknown = null;
beforeAll(async () => { saved = (await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: "landing.settings" } }))?.value ?? null; await cleanup(); });
afterAll(async () => {
  await cleanup();
  if (saved === null) await prisma.setting.deleteMany({ where: { scope: "GLOBAL", scopeId: "", key: "landing.settings" } });
  else await prisma.setting.updateMany({ where: { scope: "GLOBAL", scopeId: "", key: "landing.settings" }, data: { value: saved as object } });
});

describe("FIRINGI's settings", () => {
  it("saves checked settings and stamps the legal date when a legal text changes", async () => {
    const ctx = await ctxFor(SA);
    const s = await L.saveLandingSettings(ctx, { ...DEFAULT_LANDING, whatsapp: "+351 912 345 678", sections: { ...DEFAULT_LANDING.sections, faq: false }, texts: { "pt-PT": { "hero.h1": "Olá empresas" } }, legal: { ...DEFAULT_LANDING.legal, privacy: { en: "Our policy." } } });
    expect(s.whatsapp).toBe("351912345678");
    expect(s.legalUpdated.privacy).toBeTruthy();
    const got = await L.landingSettings();
    expect(got.sections.faq).toBe(false);
    const page = await L.landingPage("pt-PT");
    expect(page.src.own["hero.h1"]).toBe("Olá empresas");
    const legal = await L.legalPage("privacy", "en");
    expect(legal.text).toBe("Our policy.");
    expect(legal.own).toBe(true);
    const pt = await L.legalPage("privacy", "pt-PT");
    expect(pt.text).toBe("Our policy."); // FIRINGI's English wording before the built-in Portuguese text
  });
  it("falls back to the starting GDPR text with the company details", async () => {
    const ctx = await ctxFor(SA);
    await L.saveLandingSettings(ctx, { ...DEFAULT_LANDING, company: { legalName: "FIRINGI Teste Lda", nif: "509999999", address: "Lisboa" } });
    const pt = await L.legalPage("privacy", "pt-PT");
    expect(pt.own).toBe(false);
    expect(pt.text).toContain("FIRINGI Teste Lda, NIF 509999999");
    expect(pt.text).toContain("RGPD");
  });
  it("refuses bad values and non-staff", async () => {
    await expect(L.saveLandingSettings(await ctxFor(SA), { ...DEFAULT_LANDING, email: "nope" })).rejects.toThrow();
    await expect(L.saveLandingSettings(await ctxFor(BUYER), DEFAULT_LANDING)).rejects.toThrow();
  });
  it("lists every text with its English and translated wording for the editor", async () => {
    const ed = await L.landingEditor(await ctxFor(SA), "pt-PT");
    const row = ed.rows.find((r) => r.key === "app.bands.till.tag");
    expect(row?.en).toBe("Till");
    expect(row?.built).toBe("Caixa");
  });
});

describe("visitor forms → CRM", () => {
  it("turns a question into a website lead, and a second message into a note on the same lead", async () => {
    const r = await L.submitContact(msg(), visitor(), T0);
    expect(r.ok).toBe(true);
    const lead = await prisma.lead.findFirstOrThrow({ where: { email: mail("q") }, include: { country: true, contacts: true, activities: true } });
    expect(lead.source).toBe("WEBSITE");
    expect(lead.kind).toBe("CUSTOMER");
    expect(lead.country.code).toBe("PT");
    expect(lead.contacts[0].name).toBe("Ana Silva");
    expect(lead.activities[0].subject).toBe("Website: question");
    const r2 = await L.submitContact(msg({ message: "And to Faro?" }), visitor(), T0);
    expect(r2.ok && r.ok && r2.leadNumber === r.leadNumber).toBe(true);
    expect(await prisma.crmActivity.count({ where: { leadId: lead.id } })).toBe(2);
  });
  it("records a vendor application as a distributor lead with the NIF", async () => {
    const r = await L.submitContact(msg({ kind: "VENDOR", email: mail("v"), nif: "509123456", company: "Mar Distribuição" }), visitor(), T0);
    expect(r.ok).toBe(true);
    const lead = await prisma.lead.findFirstOrThrow({ where: { email: mail("v") }, include: { activities: true } });
    expect(lead.kind).toBe("DISTRIBUTOR");
    expect(lead.activities[0].subject).toBe("Website: vendor application (distributor)");
    expect(lead.activities[0].body).toContain("NIF 509123456");
  });
  it("records a wholesaler application as a wholesaler lead", async () => {
    const r = await L.submitContact(msg({ kind: "VENDOR", vendorType: "WHOLESALER", email: mail("w"), nif: "509654321", company: "Grossista Norte" }), visitor(), T0);
    expect(r.ok).toBe(true);
    const lead = await prisma.lead.findFirstOrThrow({ where: { email: mail("w") }, include: { activities: true } });
    expect(lead.kind).toBe("WHOLESALER");
    expect(lead.activities[0].subject).toBe("Website: vendor application (wholesaler)");
  });
  it("stops robots, missing consent and floods", async () => {
    expect(await L.submitContact(msg({ website: "spam.example" }), visitor(), T0)).toEqual({ ok: false, problem: "SPAM" });
    expect(await L.submitContact(msg({ startedAt: T0 - 500 }), visitor(), T0)).toEqual({ ok: false, problem: "SPAM" });
    expect(await L.submitContact(msg({ consent: false }), visitor(), T0)).toEqual({ ok: false, problem: "CONSENT" });
    const v = visitor();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await L.submitContact(msg({ email: mail(`f${i}`) }), v, T0));
    expect(results.slice(0, 5).every((x) => x.ok)).toBe(true);
    expect(results[5]).toEqual({ ok: false, problem: "BUSY" });
  });
});

describe("newsletter (double opt-in)", () => {
  it("waits for the e-mail confirmation, then can leave; only confirmed addresses are exported", async () => {
    const email = mail("n");
    expect((await L.subscribeNewsletter({ email, consent: true, website: "", startedAt: T0 - 10_000 }, visitor(), T0)).ok).toBe(true);
    const s = await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email } });
    expect(s.status).toBe("PENDING");
    expect(s.consentText).toBeTruthy();
    expect(s.countryCode).toBe("PT");
    expect(await L.exportSubscribers(await ctxFor(SA))).not.toContain(email);
    expect(await L.confirmNewsletter(s.token)).toEqual({ locale: "en" });
    expect(await L.exportSubscribers(await ctxFor(SA))).toContain(email);
    // signing up again once confirmed changes nothing
    expect((await L.subscribeNewsletter({ email, consent: true, website: "", startedAt: T0 - 10_000 }, visitor(), T0)).ok).toBe(true);
    expect((await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email } })).token).toBe(s.token);
    await L.unsubscribeNewsletter(s.token);
    expect((await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email } })).status).toBe("UNSUBSCRIBED");
    expect(await L.confirmNewsletter(s.token)).toBeNull();
    const { counts } = await L.newsletterSubscribers(await ctxFor(SA));
    expect(counts.UNSUBSCRIBED).toBeGreaterThanOrEqual(1);
  });
  it("needs consent and a real e-mail; FIRINGI can delete a subscriber", async () => {
    expect(await L.subscribeNewsletter({ email: "x@", consent: true, website: "", startedAt: T0 - 10_000 }, visitor(), T0)).toEqual({ ok: false, problem: "EMAIL" });
    expect(await L.subscribeNewsletter({ email: mail("c"), consent: false, website: "", startedAt: T0 - 10_000 }, visitor(), T0)).toEqual({ ok: false, problem: "CONSENT" });
    await L.subscribeNewsletter({ email: mail("d"), consent: true, website: "", startedAt: T0 - 10_000 }, visitor(), T0);
    const s = await prisma.newsletterSubscriber.findUniqueOrThrow({ where: { email: mail("d") } });
    await L.deleteSubscriber(await ctxFor(SA), s.id);
    expect(await prisma.newsletterSubscriber.findUnique({ where: { email: mail("d") } })).toBeNull();
    await expect(L.deleteSubscriber(await ctxFor(BUYER), s.id)).rejects.toThrow();
  });
});

describe("visitor's country", () => {
  it("comes from the browser when it is an open market, otherwise the first open market", async () => {
    expect((await L.visitorCountry("pt-PT,pt;q=0.9"))?.code).toBe("PT");
    expect(await L.visitorCountry("en-US,en;q=0.9")).toBeTruthy();
  });
});
