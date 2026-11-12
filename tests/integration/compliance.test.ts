/**
 * Phase 28: supplier compliance.
 *  • A required certificate the supplier lacks pauses all its offers (or only the offers in the type's
 *    categories); customers no longer see them; approving the certificate resumes them.
 *  • Uploads are checked (number, expiry, already expired); only FIRINGI compliance staff review.
 *  • Daily job: one reminder per threshold (30/14/7 days), expiry, grace days, waivers.
 *  • Verified badges: only approved, in-date certificates of types whose badge FIRINGI switched on,
 *    not hidden for the supplier; public download only when the type allows it.
 *  • Dashboards and the audit trail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  approveCertificate, badgesFor, certificateFile, complianceAudit, complianceOverview, grantWaiver, listTypes, markRechecked, myCompliance,
  recomputeAll, recomputeCompany, rejectCertificate, revokeCertificate, revokeWaiver, runComplianceJob, saveType, setBadgeHidden, setTypeBadge,
  supplierList, uploadCertificate, vendorsWithBadge, withdrawCertificate,
} from "@/server/compliance/service";
import { browseCatalogue, catalogueItem } from "@/server/data/catalogue-buyer";
import { ctxFor, pdfFile } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", ATL = "owner@atlantico.test";
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * DAY));
let lxId: string, mozz: string, other: string, mozzCategory: string, haccp: string, halal: string;
const typeInput = async (id: string) => {
  const t = await prisma.certificateType.findUniqueOrThrow({ where: { id } });
  return { name: t.name, description: t.description, appliesTo: t.appliesTo as ("DISTRIBUTOR" | "WHOLESALER")[], countryIds: t.countryIds, categoryIds: t.categoryIds, required: t.required, needsNumber: t.needsNumber, hasExpiry: t.hasExpiry, recheckMonths: t.recheckMonths, graceDays: t.graceDays, badgeEnabled: t.badgeEnabled, publicDownload: t.publicDownload, isActive: t.isActive };
};
const visible = async (offerId: string) => catalogueItem(await ctxFor(KEBAB), offerId).then(() => true, () => false);

async function cleanup() {
  await prisma.certificate.deleteMany({});
  await prisma.complianceWaiver.deleteMany({});
  await prisma.certificateType.updateMany({ data: { required: false, categoryIds: [] } });
  await prisma.certificateType.update({ where: { key: "HACCP" }, data: { graceDays: 14, badgeEnabled: true, publicDownload: false, needsNumber: false } });
  await prisma.certificateType.update({ where: { key: "HALAL" }, data: { badgeEnabled: true, publicDownload: true } });
  await recomputeAll();
}

beforeAll(async () => {
  await cleanup();
  const lx = await ctxFor(LX);
  lxId = lx.company.id;
  const m = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, vendorSku: "GRO-MOZZ2", packaging: { unitsPerPack: 1 } }, include: { packaging: { include: { variant: { include: { product: true } } } } } });
  mozz = m.id;
  mozzCategory = m.packaging.variant.product.categoryId;
  other = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lxId, status: "ACTIVE", packaging: { variant: { product: { categoryId: { not: mozzCategory } } } } } })).id;
  haccp = (await prisma.certificateType.findUniqueOrThrow({ where: { key: "HACCP" } })).id;
  halal = (await prisma.certificateType.findUniqueOrThrow({ where: { key: "HALAL" } })).id;
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("required certificates pause offers", () => {
  it("built-in types are not required, so nobody is paused by default", async () => {
    expect(await prisma.certificateType.count({ where: { required: true } })).toBe(0);
    expect(await prisma.vendorOffer.count({ where: { compliancePausedAt: { not: null } } })).toBe(0);
    expect(await visible(mozz)).toBe(true);
  });

  it("making HACCP required pauses a supplier without it — customers stop seeing its offers", async () => {
    const sa = await ctxFor(SA);
    const r = await saveType(sa, haccp, { ...(await typeInput(haccp)), required: true });
    expect(r.impact.paused).toBeGreaterThan(0);
    const lx = await prisma.company.findUniqueOrThrow({ where: { id: lxId } });
    expect(lx.compliancePausedAt).not.toBeNull();
    expect(lx.compliancePauseReason).toBe("HACCP");
    expect(await visible(mozz)).toBe(false);
    expect((await browseCatalogue(await ctxFor(KEBAB), { q: "mozzarella" })).items.some((i) => i.vendor.id === lxId)).toBe(false);
    expect(await prisma.notification.count({ where: { type: "compliance.paused", user: { email: LX } } })).toBeGreaterThan(0);
    const mine = await myCompliance(await ctxFor(LX));
    expect(mine.pausedWhole).not.toBeNull();
    expect(mine.rows.find((x) => x.type.key === "HACCP")).toMatchObject({ state: "MISSING", type: { required: true } });
    expect(mine.score).toBeLessThan(100);
  });

  it("uploads are checked; a pending upload doesn't resume; approval does", async () => {
    const lx = await ctxFor(LX);
    await expect(uploadCertificate(lx, { typeId: haccp, file: pdfFile("haccp.pdf") })).rejects.toThrow(/expiry date/);
    await expect(uploadCertificate(lx, { typeId: haccp, expiresOn: inDays(-1), file: pdfFile("haccp.pdf") })).rejects.toThrow(/already expired/);
    await expect(uploadCertificate(lx, { typeId: haccp, issuedOn: inDays(2), expiresOn: inDays(300), file: pdfFile("haccp.pdf") })).rejects.toThrow(/future/);
    await expect(uploadCertificate(lx, { typeId: halal, expiresOn: inDays(300), file: pdfFile("halal.pdf") })).rejects.toThrow(/certificate number/);
    await expect(uploadCertificate(await ctxFor(KEBAB), { typeId: haccp, expiresOn: inDays(300), file: pdfFile() })).rejects.toThrow(/permission/);
    // withdraw before review
    const w = await uploadCertificate(lx, { typeId: haccp, expiresOn: inDays(300), file: pdfFile("wrong.pdf") });
    await withdrawCertificate(lx, w);
    const id = await uploadCertificate(lx, { typeId: haccp, number: "H-77", issuer: "SGS", issuedOn: inDays(-30), expiresOn: inDays(300), file: pdfFile("haccp.pdf") });
    expect(await prisma.notification.count({ where: { type: "compliance.review", user: { email: SA } } })).toBeGreaterThan(0);
    expect(await visible(mozz)).toBe(false); // pending doesn't count
    await expect(approveCertificate(await ctxFor("support@firingi.test"), id)).rejects.toThrow(/permission/);
    await expect(approveCertificate(await ctxFor(SA), id, { expiresOn: inDays(-3) })).rejects.toThrow(/expired/);
    const r = await approveCertificate(await ctxFor(SA), id, { expiresOn: inDays(200) });
    expect(r.paused).toBe(false);
    expect(await visible(mozz)).toBe(true);
    const c = await prisma.certificate.findUniqueOrThrow({ where: { id } });
    expect(c.status).toBe("APPROVED");
    expect(iso(c.expiresOn!)).toBe(inDays(200)); // corrected from the file
    expect(c.recheckDueOn).not.toBeNull(); // HACCP: re-check every 12 months
    expect(await prisma.notification.count({ where: { type: "compliance.resumed", user: { email: LX } } })).toBeGreaterThan(0);
  });

  it("a renewal replaces the approved certificate only once approved; rejection keeps the old one", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    const old = await prisma.certificate.findFirstOrThrow({ where: { companyId: lxId, typeId: haccp, status: "APPROVED" } });
    const bad = await uploadCertificate(lx, { typeId: haccp, expiresOn: inDays(500), file: pdfFile("blurry.pdf") });
    await expect(rejectCertificate(sa, bad, "")).rejects.toThrow(/Say why/);
    await rejectCertificate(sa, bad, "The scan is unreadable");
    expect(await visible(mozz)).toBe(true);
    const good = await uploadCertificate(lx, { typeId: haccp, expiresOn: inDays(500), file: pdfFile("haccp-2027.pdf") });
    await approveCertificate(sa, good);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: old.id } })).supersededAt).not.toBeNull();
    const mine = await myCompliance(lx);
    expect(mine.rows.find((x) => x.type.key === "HACCP")).toMatchObject({ state: "VALID", currentId: good });
    expect(mine.history.length).toBeGreaterThanOrEqual(3);
  });
});

describe("daily job: reminders, expiry, grace, waivers", () => {
  it("reminds once per threshold, then expires, honours grace days and waivers", async () => {
    const cert = await prisma.certificate.findFirstOrThrow({ where: { companyId: lxId, typeId: haccp, status: "APPROVED", supersededAt: null } });
    await prisma.certificate.update({ where: { id: cert.id }, data: { expiresOn: new Date(inDays(10)) } });
    const before = await prisma.notification.count({ where: { type: "compliance.expiring", user: { email: LX } } });
    const j1 = await runComplianceJob();
    expect(j1.reminders).toBeGreaterThanOrEqual(1);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: cert.id } })).remindedDays.sort()).toEqual([14, 30]);
    await runComplianceJob();
    expect(await prisma.notification.count({ where: { type: "compliance.expiring", user: { email: LX } } })).toBe(before + 1);

    // expired yesterday: HACCP has 14 grace days → still selling
    await prisma.certificate.update({ where: { id: cert.id }, data: { expiresOn: new Date(inDays(-1)) } });
    const j2 = await runComplianceJob();
    expect(j2.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: cert.id } })).status).toBe("EXPIRED");
    expect(await visible(mozz)).toBe(true);
    expect((await myCompliance(await ctxFor(LX))).rows.find((x) => x.type.key === "HACCP")?.state).toBe("GRACE");

    // no grace → paused
    const sa = await ctxFor(SA);
    await saveType(sa, haccp, { ...(await typeInput(haccp)), graceDays: 0 });
    expect(await visible(mozz)).toBe(false);

    // a waiver lets it sell until a date; revoking it pauses again
    await expect(grantWaiver(sa, lxId, haccp, inDays(-1), "Renewal audit booked for next week")).rejects.toThrow(/today or later/);
    await expect(grantWaiver(sa, lxId, haccp, inDays(400), "Renewal audit booked for next week")).rejects.toThrow(/one year/);
    await expect(grantWaiver(sa, lxId, haccp, inDays(14), "short")).rejects.toThrow(/at least 10/);
    await grantWaiver(sa, lxId, haccp, inDays(14), "Renewal audit booked for next week");
    expect(await visible(mozz)).toBe(true);
    expect((await myCompliance(await ctxFor(LX))).rows.find((x) => x.type.key === "HACCP")?.state).toBe("WAIVED");
    // a job run 20 days later (waiver over) pauses it again
    await recomputeCompany(lxId, undefined, new Date(Date.now() + 20 * DAY));
    expect(await visible(mozz)).toBe(false);
    await recomputeCompany(lxId);
    expect(await visible(mozz)).toBe(true);
    const w = await prisma.complianceWaiver.findFirstOrThrow({ where: { companyId: lxId, revokedAt: null } });
    await revokeWaiver(sa, w.id);
    expect(await visible(mozz)).toBe(false);

    // renew → selling again; back to not required
    const fresh = await uploadCertificate(await ctxFor(LX), { typeId: haccp, expiresOn: inDays(365), file: pdfFile("haccp-new.pdf") });
    await approveCertificate(sa, fresh);
    expect(await visible(mozz)).toBe(true);
    await saveType(sa, haccp, { ...(await typeInput(haccp)), required: false, graceDays: 14 });
  });
});

describe("category certificates pause only those offers", () => {
  it("HALAL required for the mozzarella's category pauses that offer, not the others", async () => {
    const sa = await ctxFor(SA);
    await saveType(sa, halal, { ...(await typeInput(halal)), required: true, categoryIds: [mozzCategory], appliesTo: ["WHOLESALER"] });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: lxId } })).compliancePausedAt).toBeNull();
    expect((await prisma.vendorOffer.findUniqueOrThrow({ where: { id: mozz } })).compliancePauseReason).toBe("HALAL");
    expect((await prisma.vendorOffer.findUniqueOrThrow({ where: { id: other } })).compliancePausedAt).toBeNull();
    expect(await visible(mozz)).toBe(false);
    expect(await visible(other)).toBe(true);
    // distributors aren't affected (appliesTo)
    const atl = await ctxFor(ATL);
    expect(await prisma.vendorOffer.count({ where: { vendorCompanyId: atl.company.id, compliancePausedAt: { not: null } } })).toBe(0);
    const id = await uploadCertificate(await ctxFor(LX), { typeId: halal, number: "HAL-2026-001", issuer: "Instituto Halal", expiresOn: inDays(365), file: pdfFile("halal.pdf") });
    await approveCertificate(sa, id);
    expect(await visible(mozz)).toBe(true);
    const types = await listTypes(sa);
    expect(types.find((t) => t.key === "HALAL")).toMatchObject({ required: true, covered: expect.any(Number), suppliers: expect.any(Number) });
  });
});

describe("verified badges for customers", () => {
  it("shows approved, in-date badges FIRINGI switched on; hidden per supplier or per type", async () => {
    const sa = await ctxFor(SA), kebab = await ctxFor(KEBAB);
    expect((await badgesFor([lxId])).get(lxId)?.map((b) => b.key)).toEqual(["HACCP", "HALAL"]);
    expect(await vendorsWithBadge("HALAL")).toContain(lxId);
    // HALAL allows public download; HACCP doesn't
    const halalCert = (await badgesFor([lxId])).get(lxId)!.find((b) => b.key === "HALAL")!;
    expect(halalCert.certificateId).not.toBeNull();
    expect((await certificateFile(kebab, halalCert.certificateId!)).fileName).toBe("halal.pdf");
    const haccpCert = await prisma.certificate.findFirstOrThrow({ where: { companyId: lxId, typeId: haccp, status: "APPROVED", supersededAt: null } });
    await expect(certificateFile(kebab, haccpCert.id)).rejects.toThrow(/not found/i);
    // another supplier can't download it
    await expect(certificateFile(await ctxFor(ATL), halalCert.certificateId!)).rejects.toThrow(/not found/i);
    // hide for this supplier
    await setBadgeHidden(sa, halalCert.certificateId!, true);
    expect((await badgesFor([lxId])).get(lxId)?.map((b) => b.key)).toEqual(["HACCP"]);
    await expect(certificateFile(kebab, halalCert.certificateId!)).rejects.toThrow(/not found/i);
    await setBadgeHidden(sa, halalCert.certificateId!, false);
    // switch the HACCP badge off for everyone
    await setTypeBadge(sa, haccp, false);
    expect((await badgesFor([lxId])).get(lxId)?.map((b) => b.key)).toEqual(["HALAL"]);
    await setTypeBadge(sa, haccp, true);
    await expect(setTypeBadge(await ctxFor("support@firingi.test"), haccp, false)).rejects.toThrow(/permission/);
  });
});

describe("dashboards and audit", () => {
  it("overview KPIs, supplier list, re-check, revoke and the audit trail", async () => {
    const sa = await ctxFor(SA);
    const ov = await complianceOverview(sa);
    expect(ov.kpi.suppliers).toBeGreaterThan(0);
    expect(ov.kpi.compliantPct).toBeGreaterThanOrEqual(0);
    expect(ov.types.length).toBeGreaterThanOrEqual(9);
    const row = (await supplierList(sa)).find((s) => s.id === lxId)!;
    expect(row).toMatchObject({ pausedWhole: false, missingRequired: [] });
    expect(row.valid).toBeGreaterThanOrEqual(2);
    const cert = await prisma.certificate.findFirstOrThrow({ where: { companyId: lxId, typeId: haccp, status: "APPROVED", supersededAt: null } });
    await markRechecked(sa, cert.id, "Checked with SGS");
    expect((await prisma.certificate.findUniqueOrThrow({ where: { id: cert.id } })).lastCheckAt).not.toBeNull();
    // revoking the HALAL certificate pauses the mozzarella again
    const h = await prisma.certificate.findFirstOrThrow({ where: { companyId: lxId, typeId: halal, status: "APPROVED", supersededAt: null } });
    await expect(revokeCertificate(sa, h.id, "")).rejects.toThrow(/Say why/);
    await revokeCertificate(sa, h.id, "Suspended by the certification body");
    expect(await visible(mozz)).toBe(false);
    const audit = await complianceAudit(sa);
    const actions = new Set(audit.map((a) => a.action));
    for (const a of ["compliance.certificate_uploaded", "compliance.certificate_approved", "compliance.certificate_rejected", "compliance.certificate_revoked", "compliance.waiver_granted", "compliance.paused", "compliance.resumed", "compliance.type_updated", "compliance.badge_hidden"])
      expect(actions.has(a)).toBe(true);
    expect(audit.find((a) => a.action === "compliance.certificate_revoked")).toMatchObject({ company: { id: lxId }, certificate: "Halal" });
    await expect(complianceOverview(await ctxFor(KEBAB))).rejects.toThrow(/permission/);
  });
});
