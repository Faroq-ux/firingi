/**
 * Phase 2 end-to-end flows at the service layer: registration → onboarding →
 * submission → admin review → approval, plus restricted access and drivers.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { registerCompany, registerDriver } from "@/server/services/registration";
import { submitForReview, adminSetStatus, updateOwnProfile, setCommissionRate, runViesCheck, recordManualVatVerification } from "@/server/services/company";
import { saveAddress } from "@/server/services/addresses";
import { uploadCompanyDocument, uploadOwnDriverDocument, reviewDocument, documentForDownload } from "@/server/services/documents";
import { allowedRestrictions, requestRestrictionAccess, reviewRestrictionAccess } from "@/server/services/restrictions";
import { reviewDriver } from "@/server/services/drivers";
import { listCompanies } from "@/server/data/companies";
import { homeFor, portalsFor } from "@/server/rbac/guard";
import { decideApproval } from "@/server/approvals/service";
import { ctxFor, fakePdf, freshNif, pdfFile, pngFile } from "../helpers";

afterAll(() => prisma.$disconnect());

const PW = "Password123!";
const lisbon = async () => (await prisma.city.findFirstOrThrow({ where: { name: "Lisboa" } })).id;
const porto = async () => (await prisma.city.findFirstOrThrow({ where: { name: "Porto" } })).id;

async function newCustomer(opts: { cityId?: string } = {}) {
  const email = `cust.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@test.pt`;
  const nif = await freshNif();
  const { companyId } = await registerCompany({
    type: "CUSTOMER", countryCode: "PT", activityCode: "56101", legalName: `Restaurante ${email}`, taxId: nif, vatNumber: `PT${nif}`, companyEmail: email, phone: "+351910000000",
    businessType: "restaurant", owner: { name: "Rui Teste", email, password: PW },
    headOffice: { line1: "Rua A 1", postalCode: "1000-001", cityId: opts.cityId ?? (await lisbon()), cityName: "Lisboa" },
  });
  return { email, companyId };
}

describe("registration", () => {
  it("creates a PENDING company, an owner and a head-office address; owner can only do onboarding", async () => {
    const { email, companyId } = await newCustomer();
    const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { addresses: true, statusHistory: true } });
    expect(c.status).toBe("PENDING");
    expect(c.addresses.map((a) => a.kind)).toEqual(["HEAD_OFFICE"]);
    const ctx = await ctxFor(email);
    expect(ctx.membership.isOwner).toBe(true);
    expect([...ctx.permissions].sort()).toEqual(["company.addresses.manage", "company.documents.manage", "company.profile.manage"]);
    expect(homeFor(ctx)).toBe("/application-status");
    expect(portalsFor(ctx)).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: "company.registered", entityId: companyId } })).toBe(1);
  });

  it("rejects invalid NIF, duplicate company, duplicate e-mail and closed markets", async () => {
    const base = {
      type: "CUSTOMER" as const, countryCode: "PT", activityCode: "56101", legalName: "X", companyEmail: "x@x.pt", phone: "+351910000000",
      owner: { name: "X", email: `dup.${Date.now()}@x.pt`, password: PW }, headOffice: { line1: "Rua", postalCode: "1000-001", cityName: "Lisboa" },
    };
    await expect(registerCompany({ ...base, taxId: "123456780" })).rejects.toThrow(/Invalid Portuguese NIF/);
    // Every business needs its country's VAT number; in Portugal it is PT + NIF.
    const nif = await freshNif();
    await expect(registerCompany({ ...base, taxId: nif })).rejects.toThrow(/VAT number is required/);
    await expect(registerCompany({ ...base, taxId: nif, vatNumber: "ESB12345678" })).rejects.toThrow(/must start with PT/);
    await expect(registerCompany({ ...base, taxId: nif, vatNumber: "PT501964843" })).rejects.toThrow(/PT followed by the NIF/);
    const kebab = await prisma.company.findFirstOrThrow({ where: { legalName: "Kebab House Lisboa, Lda" } });
    await expect(registerCompany({ ...base, taxId: kebab.taxId, vatNumber: `PT${kebab.taxId}` })).rejects.toThrow(/already registered/);
    const nif2 = await freshNif();
    await expect(registerCompany({ ...base, taxId: nif2, vatNumber: `PT${nif2}`, owner: { ...base.owner, email: "owner@kebabhouse.test" } })).rejects.toThrow(/already exists/);
    // Customers are Portugal-only at launch.
    await expect(registerCompany({ ...base, countryCode: "ES", taxId: "B87654321", vatNumber: "ESB87654321" })).rejects.toThrow(/not open/);
  });

  it("distributors may register anywhere in the EU but need a matching VAT number", async () => {
    const reg = (countryCode: string, vatNumber: string | null) =>
      registerCompany({
        type: "DISTRIBUTOR", countryCode, legalName: `Großhandel ${Date.now()}`, taxId: `DE${Date.now()}`, vatNumber, companyEmail: "info@gh.de",
        phone: "+49301234567", owner: { name: "Hans", email: `hans.${Date.now()}.${Math.random()}@gh.de`, password: PW },
        headOffice: { line1: "Hauptstr. 1", postalCode: "10115", cityName: "Berlin" },
      });
    await expect(reg("DE", null)).rejects.toThrow(/VAT number is required/);
    await expect(reg("DE", "FR12345678901")).rejects.toThrow(/must start with DE/);
    const ok = await reg("DE", "DE123456789");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: ok.companyId } })).type).toBe("DISTRIBUTOR");
  });
});

describe("applicant onboarding → admin approval", () => {
  it("full happy path for a customer, with every step audited", async () => {
    const { email, companyId } = await newCustomer();
    const ctx = await ctxFor(email);

    await expect(submitForReview(ctx)).rejects.toThrow(/complete your application/);
    await saveAddress(ctx, { kind: "DELIVERY", label: "Restaurant", line1: "Rua B 2", postalCode: "1000-002", countryCode: "PT", cityId: await lisbon(), cityName: "Lisboa" });
    // Phase 28: no document is needed to submit; a customer is asked for one recent invoice from its POS.
    await expect(uploadCompanyDocument(ctx, { type: "POS_INVOICE", file: pdfFile("fatura.pdf") })).rejects.toThrow(/date on the invoice/);
    await expect(uploadCompanyDocument(ctx, { type: "POS_INVOICE", file: pdfFile("fatura.pdf"), issuedOn: new Date(Date.now() - 120 * 86_400_000) })).rejects.toThrow(/recent/);
    const d1 = await uploadCompanyDocument(ctx, { type: "POS_INVOICE", file: pdfFile("fatura.pdf"), issuedOn: new Date(Date.now() - 3 * 86_400_000) });
    await submitForReview(ctx);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).status).toBe("UNDER_REVIEW");

    const ops = await ctxFor("ops@firingi.test");
    await expect(adminSetStatus(ops, companyId, "APPROVED")).rejects.toThrow(/POS invoice not approved.*Approve anyway/);
    await expect(reviewDocument(ops, d1.id, "REJECTED")).rejects.toThrow(/explain/);
    await reviewDocument(ops, d1.id, "APPROVED");
    await adminSetStatus(ops, companyId, "APPROVED");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).approvalWaiver).toBeNull();

    const after = await ctxFor(email);
    expect(after.company.status).toBe("APPROVED");
    expect(after.permissions.has("buyer.orders.place")).toBe(true);
    expect(homeFor(after)).toBe("/buy");
    // Applicant was notified (in-app) and the decision is audited.
    expect(await prisma.notification.count({ where: { userId: after.user.id, type: "company.approved" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: companyId, action: { startsWith: "company.status." } } })).toBe(2);
  });

  it("admin can approve anyway without the POS invoice — with a note that is kept (Phase 28)", async () => {
    const { email, companyId } = await newCustomer();
    const ctx = await ctxFor(email);
    await saveAddress(ctx, { kind: "DELIVERY", label: "Shop", line1: "Rua C 3", postalCode: "1000-003", countryCode: "PT", cityId: await lisbon(), cityName: "Lisboa" });
    await submitForReview(ctx); // VAT + addresses are enough to submit
    const ops = await ctxFor("ops@firingi.test");
    await expect(adminSetStatus(ops, companyId, "APPROVED")).rejects.toThrow(/No recent invoice.*Approve anyway/);
    await expect(adminSetStatus(ops, companyId, "APPROVED", "ok", { approveAnyway: true })).rejects.toThrow(/at least 10/);
    await adminSetStatus(ops, companyId, "APPROVED", "Visited the shop, invoice to follow", { approveAnyway: true });
    const co = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(co.status).toBe("APPROVED");
    expect(co.approvalWaiver).toMatchObject({ items: ["POS_INVOICE_MISSING"], note: "Visited the shop, invoice to follow", byUserId: ops.user.id });
    expect(await prisma.auditLog.count({ where: { entityId: companyId, action: "company.status.approved_anyway" } })).toBe(1);
    const h = await prisma.companyStatusHistory.findFirstOrThrow({ where: { companyId, toStatus: "APPROVED" } });
    expect(h.reason).toMatch(/^Approved anyway \(without no recent invoice/);
  });

  it("reject / suspend need a reason; status changes follow the allowed transitions", async () => {
    const { email, companyId } = await newCustomer();
    const ops = await ctxFor("ops@firingi.test");
    await expect(adminSetStatus(ops, companyId, "APPROVED")).rejects.toThrow(/Cannot change status/);
    await expect(adminSetStatus(ops, companyId, "REJECTED")).rejects.toThrow(/reason/);
    await adminSetStatus(ops, companyId, "REJECTED", "Not a food business");
    const ctx = await ctxFor(email);
    expect(ctx.permissions.size).toBe(0);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).statusReason).toBe("Not a food business");
  });

  it("staff without approval rights cannot decide; sales/support can't approve", async () => {
    const { companyId } = await newCustomer();
    const support = await ctxFor("support@firingi.test");
    await expect(adminSetStatus(support, companyId, "UNDER_REVIEW")).rejects.toThrow(/permission/);
  });

  it("uploads are checked: disguised files rejected, other companies' documents invisible", async () => {
    const { email } = await newCustomer();
    const ctx = await ctxFor(email);
    await expect(uploadCompanyDocument(ctx, { type: "BUSINESS_REGISTRATION", file: fakePdf() })).rejects.toThrow(/Only PDF/);
    await expect(uploadCompanyDocument(ctx, { type: "TOBACCO_LICENCE", file: pdfFile() })).rejects.toThrow(/can't be uploaded/);
    const doc = await uploadCompanyDocument(ctx, { type: "BUSINESS_REGISTRATION", file: pdfFile() });
    await expect(documentForDownload(await ctxFor("owner@kebabhouse.test"), doc.id)).rejects.toThrow(/not found/);
    await expect(documentForDownload(await ctxFor("owner@atlantico.test"), doc.id)).rejects.toThrow(/not found/);
    expect((await documentForDownload(ctx, doc.id)).id).toBe(doc.id);
    expect((await documentForDownload(await ctxFor("ops@firingi.test"), doc.id)).id).toBe(doc.id);
  });

  it("addresses: customers can't add warehouses or foreign delivery addresses", async () => {
    const { email } = await newCustomer();
    const ctx = await ctxFor(email);
    const a = { label: "X", line1: "Rua 1", postalCode: "1000-001", cityName: "Madrid" };
    await expect(saveAddress(ctx, { ...a, kind: "WAREHOUSE", countryCode: "PT" })).rejects.toThrow(/not available/);
    await expect(saveAddress(ctx, { ...a, kind: "DELIVERY", countryCode: "ES" })).rejects.toThrow(/company's country/);
  });

  it("regional manager only sees applicants in their region", async () => {
    const inLisbon = await newCustomer({ cityId: await lisbon() });
    const inPorto = await newCustomer({ cityId: await porto() });
    const rm = await ctxFor("rm.lisboa@firingi.test");
    const ids = (await listCompanies(rm, { types: ["CUSTOMER"], statuses: ["PENDING"] })).rows.map((r) => r.id);
    expect(ids).toContain(inLisbon.companyId);
    expect(ids).not.toContain(inPorto.companyId);
    await expect(adminSetStatus(rm, inPorto.companyId, "UNDER_REVIEW")).rejects.toThrow(/not found/);
  });
});

describe("vendor approval: commission + VIES", () => {
  it("a distributor needs a VIES-confirmed VAT number, a commission rate and its certificate code", async () => {
    const email = `dist.${Date.now()}@test.pt`;
    const nif = await freshNif();
    const { companyId } = await registerCompany({
      type: "DISTRIBUTOR", countryCode: "PT", legalName: `Distribuidora ${Date.now()}`, taxId: nif, vatNumber: `PT${nif}`, companyEmail: email,
      phone: "+351910000000", owner: { name: "D", email, password: PW }, headOffice: { line1: "Rua 1", postalCode: "4000-001", cityId: await porto(), cityName: "Porto" },
    });
    const ctx = await ctxFor(email);
    // Distributor warehouse may be in another EU country (cross-border).
    await saveAddress(ctx, { kind: "WAREHOUSE", label: "Madrid hub", line1: "Calle 1", postalCode: "28001", countryCode: "ES", cityName: "Madrid" });
    await submitForReview(ctx); // Phase 28: no documents needed

    const sa = await ctxFor("superadmin@firingi.test");
    for (const d of await prisma.document.findMany({ where: { companyId } })) await reviewDocument(sa, d.id, "APPROVED");
    await expect(adminSetStatus(sa, companyId, "APPROVED")).rejects.toThrow(/VIES.*Commission/s);

    // VIES outage → ERROR is recorded and does not count as valid.
    const outage = (async () => { throw new Error("blocked"); }) as unknown as typeof fetch;
    expect((await runViesCheck(sa, companyId, outage)).result).toBe("ERROR");
    const valid = (async () => new Response(JSON.stringify({ valid: true, name: "DIST", requestIdentifier: "REF1" }))) as unknown as typeof fetch;
    expect((await runViesCheck(sa, companyId, valid)).result).toBe("VALID");

    // Finance can set commission; operations cannot.
    await expect(setCommissionRate(await ctxFor("ops@firingi.test"), companyId, 7)).rejects.toThrow(/permission/);
    await setCommissionRate(await ctxFor("finance@firingi.test"), companyId, 7);
    // Changing an agreed rate needs a second person (four-eyes): finance asks, superadmin approves.
    await expect(setCommissionRate(await ctxFor("finance@firingi.test"), companyId, 6.5, "renegotiated")).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { kind: "COMMISSION", status: "PENDING", companyId }, orderBy: { requestedAt: "desc" } });
    await expect(decideApproval(await ctxFor("finance@firingi.test"), req.id, true, null)).rejects.toThrow(/second person/);
    await decideApproval(sa, req.id, true, null);
    const rules = await prisma.commissionRule.findMany({ where: { vendorCompanyId: companyId }, orderBy: { validFrom: "asc" } });
    expect(rules.map((r) => [Number(r.rate), r.validTo === null])).toEqual([[7, false], [6.5, true]]);

    // A supplier company is also asked for its permanent certificate code (waivable; a sole trader isn't).
    await expect(adminSetStatus(sa, companyId, "APPROVED")).rejects.toThrow(/Permanent certificate code/);
    await expect(updateOwnProfile(ctx, { email, certificateCode: "1234-56" })).rejects.toThrow(/12 digits/);
    await updateOwnProfile(ctx, { email, certificateCode: "123456789012" });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).registryCertificateCode).toBe("1234-5678-9012");
    await adminSetStatus(sa, companyId, "APPROVED");
    expect(portalsFor(await ctxFor(email))).toEqual(["vendor"]);
  });

  it("manual VAT verification needs an explanation and is recorded", async () => {
    const dist = await prisma.company.findFirstOrThrow({ where: { legalName: "Distribuciones Ibéricas S.L." } });
    const sa = await ctxFor("superadmin@firingi.test");
    await expect(recordManualVatVerification(sa, dist.id, "ok")).rejects.toThrow(/at least 10/);
    await recordManualVatVerification(sa, dist.id, "Checked on VIES website, ref WAPI-999");
    expect((await prisma.vatValidation.findFirstOrThrow({ where: { companyId: dist.id }, orderBy: { checkedAt: "desc" } })).consultationRef).toMatch(/^MANUAL/);
  });
});

describe("tobacco & alcohol access (checklist: no restricted products without approved licence)", () => {
  it("request → approve with expiry → allowed; expired or revoked → not allowed", async () => {
    const owner = await ctxFor("owner@kebabhouse.test");
    expect(await allowedRestrictions(owner.company.id)).toEqual([]);
    const req = await requestRestrictionAccess(owner, { restriction: "TOBACCO", licenceNumber: "TAB-123", issuingAuthority: "AT", file: pdfFile("licenca.pdf") });
    await expect(requestRestrictionAccess(owner, { restriction: "TOBACCO", licenceNumber: "TAB-123", issuingAuthority: "AT", file: pdfFile() })).rejects.toThrow(/already waiting/);
    expect(await allowedRestrictions(owner.company.id)).toEqual([]); // pending ≠ allowed

    const ops = await ctxFor("ops@firingi.test");
    await expect(reviewRestrictionAccess(ops, req.id, "APPROVED", {})).rejects.toThrow(/valid/);
    const until = new Date(Date.now() + 365 * 86400000);
    await reviewRestrictionAccess(ops, req.id, "APPROVED", { validUntil: until });
    expect(await allowedRestrictions(owner.company.id)).toEqual(["TOBACCO"]);
    expect(await allowedRestrictions(owner.company.id, new Date(until.getTime() + 1000))).toEqual([]); // after expiry

    await expect(reviewRestrictionAccess(ops, req.id, "REVOKED", {})).rejects.toThrow(/reason/);
    await reviewRestrictionAccess(ops, req.id, "REVOKED", { note: "Licence withdrawn by AT" });
    expect(await allowedRestrictions(owner.company.id)).toEqual([]);
  });

  it("employees without the compliance permission can't request access", async () => {
    await expect(
      requestRestrictionAccess(await ctxFor("buyer@kebabhouse.test"), { restriction: "ALCOHOL", licenceNumber: "A1", issuingAuthority: "X", file: pdfFile() }),
    ).rejects.toThrow(/permission/);
  });
});

describe("drivers", () => {
  it("applicant driver has no driver permissions until documents and the driver are approved", async () => {
    const email = `drv.${Date.now()}@test.pt`;
    const { driverId } = await registerDriver({ name: "Diogo", email, password: PW, phone: "+351911111111", licenceNumber: "P-998877" });
    let ctx = await ctxFor(email);
    expect(ctx.permissions.size).toBe(0);
    expect(homeFor(ctx)).toBe("/application-status");

    const id = await uploadOwnDriverDocument(ctx, { type: "ID_DOCUMENT", file: pdfFile() });
    const lic = await uploadOwnDriverDocument(ctx, { type: "DRIVING_LICENCE", file: pngFile() });
    const sa = await ctxFor("superadmin@firingi.test");
    await expect(reviewDriver(sa, driverId, "APPROVED")).rejects.toThrow(/Approve these documents/);
    await reviewDocument(sa, id.id, "APPROVED");
    await reviewDocument(sa, lic.id, "APPROVED");
    await expect(reviewDriver(await ctxFor("support@firingi.test"), driverId, "APPROVED")).rejects.toThrow(/permission/);
    await reviewDriver(sa, driverId, "APPROVED");

    ctx = await ctxFor(email);
    expect(ctx.permissions.has("driver.deliveries.view")).toBe(true);
    expect(ctx.permissions.has("admin.dashboard.view")).toBe(false); // a FIRINGI driver is not back-office staff
    expect(homeFor(ctx)).toBe("/driver");
  });
});
