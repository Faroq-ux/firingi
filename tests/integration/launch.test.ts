/**
 * Phase 33: launch — the readiness checklist (server settings, FIRINGI's invoicing details, providers,
 * demo data, legal links), FIRINGI's legal entities (add / edit, tax number locked once invoiced) and
 * the invite-only pilot (registration needs a valid invitation, used once; e-mailed in the country's
 * language; revoked / expired / wrong type refused; the pilot banner).
 */
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { registerCompany } from "@/server/services/registration";
import * as L from "@/server/launch/service";
import { ctxFor, freshNif } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", SALES = "sales@firingi.test";
let ptEntity: { id: string; email: string; phone: string | null };

beforeAll(async () => {
  const pt = await prisma.legalEntity.findFirstOrThrow({ where: { country: { code: "PT" } } });
  ptEntity = { id: pt.id, email: pt.email, phone: pt.phone };
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "launch.settings" } });
  await prisma.pilotInvite.deleteMany({});
  await prisma.invoice.deleteMany({ where: { legalEntity: { country: { code: "ES" } }, status: "DRAFT" } });
  await prisma.legalEntity.deleteMany({ where: { country: { code: "ES" } } });
  await prisma.legalEntity.update({ where: { id: ptEntity.id }, data: { email: ptEntity.email, phone: ptEntity.phone } });
  await prisma.$disconnect();
});

const GOOD_ENV = {
  DATABASE_URL: "postgresql://x", FIRINGI_ENV: "production", BETTER_AUTH_SECRET: "k".repeat(40).replace(/k/g, "q"), BETTER_AUTH_URL: "https://firingi.pt", APP_URL: "https://firingi.pt",
  CRON_SECRET: "c".repeat(30), STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s", MAIL_DRIVER: "smtp", SMTP_URL: "smtp://mail:25",
  STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_x", ANTHROPIC_API_KEY: "sk-ant-x", SENTRY_DSN: "https://x@sentry.io/1", BACKUP_ENCRYPTION_KEY: "b".repeat(32),
  PUSH_DRIVER: "webpush", VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "q", SMS_DRIVER: "twilio", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t",
};
const byKey = (r: L.LaunchReport) => Object.fromEntries(r.checks.map((c) => [c.key, c]));

describe("launch readiness", () => {
  it("IBAN check digits", () => {
    expect(L.ibanValid("PT50 0002 0123 1234 5678 9015 4")).toBe(true);
    expect(L.ibanValid("DE89370400440532013000")).toBe(true);
    expect(L.ibanValid("PT50 0000 0000 0000 0000 0000 0")).toBe(false);
    expect(L.ibanValid("")).toBe(false);
  });

  it("only FIRINGI staff with settings access see it", async () => {
    await expect(L.launchReadiness(await ctxFor(KEBAB))).rejects.toThrow();
    await expect(L.saveLaunchSettings(await ctxFor(SALES), { pilot: true })).rejects.toThrow();
  });

  it("a development setup is not ready: test shortcuts, no e-mail, demo data, no legal links", async () => {
    const r = await L.launchReadiness(await ctxFor(SA), { env: { DATABASE_URL: "postgresql://x", PAYMENTS_SIMULATE: "1", MOLONI_SIMULATE: "1", ASSISTANT_SIMULATE: "1", AUTH_SIGNIN_RATE_LIMIT: "500" } });
    const c = byKey(r);
    expect(r.verdict).toBe("not-ready");
    expect(c.production.state).toBe("fail");
    expect(c.env.state).toBe("fail");
    expect(c.env.detail).toMatch(/BETTER_AUTH_SECRET/);
    expect(c.email.state).toBe("fail");
    expect(c.payments.state).toBe("fail");
    expect(c.payments.detail).toMatch(/SIMULATED/);
    expect(c.ai.state).toBe("fail");
    expect(c.ratelimit.state).toBe("warn");
    expect(c.demo.state).toBe("fail"); // the demo accounts (*.test)
    expect(c[`iban:${ptEntity.id}`].state).toBe("fail"); // demo IBAN
    expect(c[`entity:${ptEntity.id}`].detail).toMatch(/demo address/);
    expect(c.fiscal.state).toBe("fail"); // internal invoicing in Portugal
    expect(c.terms.state).toBe("fail");
    expect(c.privacy.state).toBe("fail");
    expect(c.backup.state).toBe("fail");
    expect(c.countries.state).toBe("pass");
    expect(c["vat:PT"].state).toBe("pass");
    // delivery zones: none → nothing can be delivered; one active zone → OK
    const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
    const had = await prisma.deliveryZone.count({ where: { countryId: pt.id, isActive: true } });
    const zone = had ? null : await prisma.deliveryZone.create({ data: { countryId: pt.id, name: "Lisboa (launch test)", postalCodePatterns: ["1*"] } });
    try {
      expect(byKey(await L.launchReadiness(await ctxFor(SA)))["zones:PT"].state).toBe("pass");
    } finally {
      if (zone) await prisma.deliveryZone.delete({ where: { id: zone.id } });
    }
    if (!had) expect(c["zones:PT"].state).toBe("fail");
    expect(r.counts.fail).toBeGreaterThan(5);
    for (const x of r.checks) if (x.state !== "pass") expect(x.fix?.href).toMatch(/^\/admin\//);
  });

  it("production settings and legal links turn their checks green", async () => {
    const sa = await ctxFor(SA);
    await expect(L.saveLaunchSettings(sa, { termsUrl: "not a link" })).rejects.toThrow(/Terms of service/);
    await expect(L.saveLaunchSettings(sa, { supportEmail: "nope" })).rejects.toThrow(/Support e-mail/);
    await L.saveLaunchSettings(sa, { termsUrl: "https://firingi.pt/terms", privacyUrl: "/privacy", supportEmail: "Support@Firingi.pt" });
    expect((await L.launchSettings()).supportEmail).toBe("support@firingi.pt");
    const c = byKey(await L.launchReadiness(sa, { env: GOOD_ENV }));
    for (const k of ["production", "env", "storage", "sentry", "email", "sms", "push", "ai", "encrypt", "terms", "privacy", "support"]) expect([k, c[k].state]).toEqual([k, "pass"]);
    expect(c.payments.state).toBe("pass");
    // Stripe in test mode is only a warning; without the webhook secret payments are never confirmed
    expect(byKey(await L.launchReadiness(sa, { env: { ...GOOD_ENV, STRIPE_SECRET_KEY: "sk_test_x" } })).payments.state).toBe("warn");
    expect(byKey(await L.launchReadiness(sa, { env: { ...GOOD_ENV, STRIPE_WEBHOOK_SECRET: "" } })).payments.state).toBe("fail");
    // No online payments at all is fine for a pilot (bank transfer)
    expect(byKey(await L.launchReadiness(sa, { env: { ...GOOD_ENV, STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" } })).payments.state).toBe("warn");
    // Moloni chosen with live keys but no mappings → fail with what's missing
    await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "invoicing.provider" } }, update: { value: { provider: "moloni" } }, create: { scope: "GLOBAL", key: "invoicing.provider", value: { provider: "moloni" } } });
    try {
      const f = byKey(await L.launchReadiness(sa, { env: { ...GOOD_ENV, MOLONI_CLIENT_ID: "i", MOLONI_CLIENT_SECRET: "s", MOLONI_USERNAME: "u", MOLONI_PASSWORD: "p" } })).fiscal;
      expect(f.state).toBe("fail");
      expect(f.detail).toMatch(/invoiceSetId/);
    } finally {
      await prisma.setting.deleteMany({ where: { key: "invoicing.provider" } });
    }
  });
});

describe("FIRINGI invoicing entities", () => {
  it("edits the details; adds a country; one active entity per country; tax number locked once invoiced", async () => {
    const sa = await ctxFor(SA);
    const pt = await prisma.legalEntity.findUniqueOrThrow({ where: { id: ptEntity.id } });
    const base = { countryCode: "PT", legalName: pt.legalName, taxId: pt.taxId, vatNumber: pt.vatNumber, addressLine: pt.addressLine, postalCode: pt.postalCode, city: pt.city, email: "faturas@firingi.pt", phone: "+351 210 000 001" };
    await expect(L.saveLegalEntity(await ctxFor(KEBAB), base, pt.id)).rejects.toThrow();
    await expect(L.saveLegalEntity(sa, { ...base, email: "x" }, pt.id)).rejects.toThrow(/e-mail/);
    await expect(L.saveLegalEntity(sa, { ...base, vatNumber: "ES123" }, pt.id)).rejects.toThrow(/starts with PT/);
    await L.saveLegalEntity(sa, base, pt.id);
    const after = await prisma.legalEntity.findUniqueOrThrow({ where: { id: pt.id } });
    expect([after.email, after.phone]).toEqual(["faturas@firingi.pt", "+351 210 000 001"]);
    expect(await prisma.auditLog.count({ where: { action: "legal_entity.updated", entityId: pt.id } })).toBeGreaterThan(0);
    // the demo-e-mail problem is gone from the checklist
    expect(byKey(await L.launchReadiness(sa, { env: GOOD_ENV }))[`entity:${pt.id}`].state).toBe("pass");
    await expect(L.saveLegalEntity(sa, { ...base, countryCode: "PT" })).rejects.toThrow(/already has an active invoicing entity/);

    const es = { countryCode: "ES", legalName: "FIRINGI España, S.L.", taxId: "B12345674", vatNumber: "ESB12345674", addressLine: "Calle Mayor 1", postalCode: "28013", city: "Madrid", email: "facturas@firingi.es", phone: "+34 910 000 000" };
    await expect(L.saveLegalEntity(sa, { ...es, countryCode: "GB" })).rejects.toThrow(/Schengen/);
    const row = await L.saveLegalEntity(sa, es);
    expect(row.taxId).toBe("B12345674");
    // tax number can still change while nothing was invoiced…
    await L.saveLegalEntity(sa, { ...es, taxId: "B12345675", vatNumber: "ESB12345675" }, row.id);
    // …but not once an invoice exists
    const kebab = await ctxFor(KEBAB);
    await prisma.invoice.create({ data: { legalEntityId: row.id, docType: "INVOICE", recipientCompanyId: kebab.company.id, issuerSnapshot: {}, recipientSnapshot: {}, netTotal: 0, vatTotal: 0, grossTotal: 0 } });
    await expect(L.saveLegalEntity(sa, { ...es, taxId: "B99999999", vatNumber: "ESB99999999" }, row.id)).rejects.toThrow(/already issued/);
    await L.saveLegalEntity(sa, { ...es, taxId: "B12345675", vatNumber: "ESB12345675", city: "Barcelona" }, row.id);
    expect((await prisma.legalEntity.findUniqueOrThrow({ where: { id: row.id } })).city).toBe("Barcelona");
  });
});

describe("pilot: invitation-only registration", () => {
  const outbox = path.resolve(process.env.STORAGE_DIR ?? "./storage", "mail-outbox");
  const lisbon = async () => (await prisma.city.findFirstOrThrow({ where: { name: "Lisboa" } })).id;
  const reg = async (email: string, invite?: string | null) => {
    const nif = await freshNif();
    return registerCompany({
      type: "CUSTOMER", countryCode: "PT", activityCode: "56101", invite, legalName: `Tasca ${email}`, taxId: nif, vatNumber: `PT${nif}`, companyEmail: email, phone: "+351910000000",
      businessType: "restaurant", owner: { name: "Ana Piloto", email, password: "Pilot!2026xyz" },
      headOffice: { line1: "Rua B 2", postalCode: "1000-002", cityId: await lisbon(), cityName: "Lisboa" },
    });
  };

  beforeAll(async () => { await L.saveLaunchSettings(await ctxFor(SA), { pilot: true, pilotBanner: true, supportEmail: "piloto@firingi.pt" }); });

  it("without an invitation nobody can register; the banner shows for businesses, not staff", async () => {
    await expect(reg(`noinvite${Date.now()}@pilot.pt`)).rejects.toThrow(/invitation only/);
    expect(await L.pilotBanner(await ctxFor(KEBAB))).toEqual({ supportEmail: "piloto@firingi.pt" });
    expect(await L.pilotBanner(await ctxFor(SA))).toBeNull();
    expect((await L.publicLaunchInfo()).pilot).toBe(true);
  });

  it("an invitation is e-mailed in the country's language, works once, for its type and country only", async () => {
    const sa = await ctxFor(SA);
    const email = `convite${Date.now()}@pilot.pt`;
    await expect(L.createInvite(sa, { email, companyName: "Tasca do Zé", type: "CUSTOMER", countryCode: "ES" })).rejects.toThrow(/isn't open/);
    await expect(L.createInvite(sa, { email: KEBAB, companyName: "Kebab", type: "CUSTOMER", countryCode: "PT" })).rejects.toThrow(/already has an account/);
    await expect(L.createInvite(await ctxFor(KEBAB), { email, companyName: "x", type: "CUSTOMER", countryCode: "PT" })).rejects.toThrow();
    const before = new Set(await readdir(outbox).catch(() => [] as string[]));
    const inv = await L.createInvite(sa, { email, companyName: "Tasca do Zé", type: "CUSTOMER", countryCode: "PT", activityCode: "56101", days: 14 });
    expect(inv.link).toMatch(new RegExp(`/register/customer\\?invite=${inv.code}$`));
    expect(inv.sentAt).not.toBeNull();
    await expect(L.createInvite(sa, { email, companyName: "Tasca do Zé", type: "CUSTOMER", countryCode: "PT" })).rejects.toThrow(/open invitation/);
    const mails = await Promise.all((await readdir(outbox)).filter((f) => f.endsWith(".json") && !before.has(f)).map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8"))));
    const mail = mails.find((m) => m.to === email);
    expect(mail.subject).toBe("O seu convite para a FIRINGI");
    expect(mail.text).toContain("Tasca do Zé");
    expect(mail.text).toContain(inv.link);
    expect(mail.text).toMatch(/14 dias/);

    expect(await L.checkInvite("NOPE00000", "CUSTOMER")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await L.checkInvite(null, "CUSTOMER")).toMatchObject({ ok: false, reason: "missing" });
    expect(await L.checkInvite(inv.code, "WHOLESALER")).toMatchObject({ ok: false, reason: "type" });
    expect(await L.checkInvite(inv.code.toLowerCase(), "CUSTOMER")).toMatchObject({ ok: true, email, companyName: "Tasca do Zé", countryCode: "PT" });

    const { companyId } = await reg(email, inv.code);
    const used = await prisma.pilotInvite.findUniqueOrThrow({ where: { id: inv.id } });
    expect(used.usedAt).not.toBeNull();
    expect(used.usedByCompanyId).toBe(companyId);
    expect(await L.checkInvite(inv.code, "CUSTOMER")).toMatchObject({ ok: false, reason: "used" });
    await expect(reg(`again${Date.now()}@pilot.pt`, inv.code)).rejects.toThrow(/no longer valid/);
    await expect(L.revokeInvite(sa, inv.id)).rejects.toThrow(/already used/);
    expect((await prisma.companyStatusHistory.findFirstOrThrow({ where: { companyId } })).reason).toMatch(/pilot invitation/);
  });

  it("revoked and expired invitations are refused; the list shows each state", async () => {
    const sa = await ctxFor(SA);
    const a = await L.createInvite(sa, { email: `rev${Date.now()}@pilot.pt`, companyName: "Café Revogado", type: "CUSTOMER", countryCode: "PT", activityCode: "56101", send: false });
    expect(a.sentAt).toBeNull();
    await L.revokeInvite(sa, a.id);
    expect(await L.checkInvite(a.code, "CUSTOMER")).toMatchObject({ ok: false, reason: "revoked" });
    await expect(reg(`rev2${Date.now()}@pilot.pt`, a.code)).rejects.toThrow(/no longer valid/);
    await expect(L.sendInvite(sa, a.id)).rejects.toThrow(/Only open/);
    const b = await L.createInvite(sa, { email: `exp${Date.now()}@pilot.pt`, companyName: "Bar Expirado", type: "WHOLESALER", countryCode: "PT", send: false });
    await prisma.pilotInvite.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await L.checkInvite(b.code, "WHOLESALER")).toMatchObject({ ok: false, reason: "expired" });
    const states = new Set((await L.listInvites(sa)).map((i) => i.state));
    expect([...states].sort()).toEqual(["expired", "revoked", "used"]);
    expect(byKey(await L.launchReadiness(sa, { env: GOOD_ENV })).pilot.detail).toMatch(/invitation only/);
  });

  it("with the pilot off, registration is open again", async () => {
    await L.saveLaunchSettings(await ctxFor(SA), { pilot: false });
    const { companyId } = await reg(`open${Date.now()}@pilot.pt`);
    expect(companyId).toBeTruthy();
    expect(await L.pilotBanner(await ctxFor(KEBAB))).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: { in: ["launch.pilot_on", "launch.pilot_off"] } } })).toBeGreaterThanOrEqual(2);
  });
});
