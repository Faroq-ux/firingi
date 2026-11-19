/**
 * Phase 47d — registration details fixed for every distributor, wholesaler and wholesale customer (NIF, VAT number,
 * legal name, legal form, activity code — only FIRINGI corrects them), one company per NIF / VAT number, and address
 * changes: the first time an address (or a new place) is used FIRINGI approves it, with a recent till invoice as
 * proof (FIRINGI may bypass); name / contact edits and removals apply at once; an address printed on till receipts
 * is fixed for good.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { registerCompany } from "@/server/services/registration";
import { adminCorrectRegistration, updateOwnProfile } from "@/server/services/company";
import * as A from "@/server/services/addresses";
import { addShopAddress, saveBranch } from "@/server/multisite/branches";
import { saveRegister } from "@/server/pos/service";
import { checkActivityCode, activityScheme } from "@/lib/activity-code";
import { ctxFor, freshNif, makeApprovedCompany, pngFile } from "../helpers";

const SA = "superadmin@firingi.test", KH = "owner@kebabhouse.test";
const PW = "Firingi!2026-test";
const made: string[] = [];
let saved: unknown = null;
const lisbon = async () => (await prisma.city.findFirstOrThrow({ where: { name: "Lisboa" } })).id;
const addr = async (label: string, line1: string, extra: Partial<A.AddressInput> = {}): Promise<A.AddressInput> => ({ kind: "DELIVERY", label, line1, postalCode: "1100-001", countryCode: "PT", cityId: await lisbon(), cityName: "Lisboa", ...extra });
const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

beforeAll(async () => {
  saved = (await prisma.setting.findFirst({ where: { key: "address.approval" } }))?.value ?? null;
  await A.saveAddressApprovalSettings(await ctxFor(SA), { enabled: true, proofRequired: true, kinds: { HEAD_OFFICE: true, BILLING: true, WAREHOUSE: true, PICKUP: true, DELIVERY: true } });
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "address.approval" } });
  if (saved) await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: "address.approval", value: saved as never } });
  await prisma.posSale.deleteMany({ where: { companyId: { in: made } } });
  await prisma.posRegister.deleteMany({ where: { companyId: { in: made } } });
  // companies stay (their status history is append-only); the test database is rebuilt on every run
  await prisma.$disconnect();
});

describe("activity code (CAE in Portugal, the national code elsewhere)", () => {
  it("each country's name and format", () => {
    expect(activityScheme("PT").name).toBe("CAE");
    expect(activityScheme("ES").name).toBe("CNAE");
    expect(activityScheme("FR").name).toBe("NAF / APE");
    expect(activityScheme("XX").name).toBe("NACE");
    expect(checkActivityCode("56.101", "PT")).toEqual({ ok: true, value: "56101" });
    expect(checkActivityCode("5610", "PT").ok).toBe(false);
    expect(checkActivityCode("56.10a", "FR")).toEqual({ ok: true, value: "5610A" });
    expect(checkActivityCode("5610", "ES").ok).toBe(true);
  });
});

describe("registration details: one company, one NIF — fixed for the company, corrected by FIRINGI", () => {
  it("a wholesale customer gives its CAE; the same NIF or VAT number can't register again, whatever the type", async () => {
    const nif = await freshNif();
    const base = { countryCode: "PT", legalName: `Tasca ${nif}`, taxId: nif, vatNumber: `PT${nif}`, companyEmail: `t${nif}@test.pt`, phone: "+351910000000", headOffice: { line1: "Rua 1", postalCode: "1100-001", cityId: await lisbon(), cityName: "Lisboa" } };
    await expect(registerCompany({ ...base, type: "CUSTOMER", owner: { name: "T", email: `o${nif}@test.pt`, password: PW } })).rejects.toThrow(/CAE code/);
    await expect(registerCompany({ ...base, type: "CUSTOMER", activityCode: "561", owner: { name: "T", email: `o${nif}@test.pt`, password: PW } })).rejects.toThrow(/CAE code/);
    const { companyId } = await registerCompany({ ...base, type: "CUSTOMER", activityCode: "56.101", owner: { name: "T", email: `o${nif}@test.pt`, password: PW } });
    made.push(companyId);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).activityCode).toBe("56101");
    // the same NIF as a wholesaler (another type) — refused: one company per NIF
    await expect(registerCompany({ ...base, type: "WHOLESALER", owner: { name: "T", email: `w${nif}@test.pt`, password: PW } })).rejects.toThrow(/one company, one NIF/);
  });

  it("the company can't change NIF, VAT number, legal name, legal form or (once given) its activity code; FIRINGI corrects them with a reason", async () => {
    const f = await makeApprovedCompany("CUSTOMER");
    made.push(f.companyId);
    const ctx = await ctxFor(f.email);
    const c = await prisma.company.findUniqueOrThrow({ where: { id: f.companyId } });
    await expect(updateOwnProfile(ctx, { email: c.email, vatNumber: "PT999999990" })).rejects.toThrow(/can't be changed/);
    await expect(updateOwnProfile(ctx, { email: c.email, legalName: "Another name" })).rejects.toThrow(/can't be changed/);
    await expect(updateOwnProfile(ctx, { email: c.email, legalForm: c.legalForm === "COMPANY" ? "SOLE_TRADER" : "COMPANY" })).rejects.toThrow(/can't be changed/);
    await updateOwnProfile(ctx, { email: c.email, tradeName: "Nova Tasca", legalName: c.legalName });
    // activity code: entered once, then fixed
    await updateOwnProfile(ctx, { email: c.email, activityCode: "56101" });
    await expect(updateOwnProfile(ctx, { email: c.email, activityCode: "47111" })).rejects.toThrow(/can't be changed/);
    // FIRINGI corrects (reason required; no clash with another company)
    const sa = await ctxFor(SA);
    await expect(adminCorrectRegistration(ctx, f.companyId, { legalName: "x", taxId: "1", vatNumber: "x", legalForm: "COMPANY", reason: "no rights here" })).rejects.toThrow();
    const nif = await freshNif();
    await expect(adminCorrectRegistration(sa, f.companyId, { legalName: "Tasca Certa, Lda", taxId: nif, vatNumber: `PT${nif}`, legalForm: "COMPANY", reason: "short" })).rejects.toThrow(/reason/);
    const kh = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: KH } } } } });
    await expect(adminCorrectRegistration(sa, f.companyId, { legalName: "Tasca Certa, Lda", taxId: kh.taxId, vatNumber: `PT${kh.taxId}`, legalForm: "COMPANY", reason: "Typo in the NIF at sign-up" })).rejects.toThrow(/one company, one NIF/);
    await adminCorrectRegistration(sa, f.companyId, { legalName: "Tasca Certa, Lda", taxId: nif, vatNumber: `PT${nif}`, legalForm: "COMPANY", activityCode: "56.102", reason: "Typo in the NIF at sign-up, checked against the certificate" });
    const after = await prisma.company.findUniqueOrThrow({ where: { id: f.companyId } });
    expect(after).toMatchObject({ legalName: "Tasca Certa, Lda", taxId: nif, vatNumber: `PT${nif}`, activityCode: "56102" });
    expect(await prisma.auditLog.count({ where: { action: "company.registration_corrected", entityId: f.companyId } })).toBe(1);
  });
});

describe("addresses: FIRINGI approves the first time, with a recent till invoice", () => {
  it("a new shop address waits; FIRINGI needs the till invoice or bypasses; then edits of name / phone apply at once; a move waits again", async () => {
    const f = await makeApprovedCompany("CUSTOMER");
    made.push(f.companyId);
    const ctx = await ctxFor(f.email), sa = await ctxFor(SA);
    // new address without the invoice → waiting, nothing created yet
    const r1 = await A.saveAddress(ctx, await addr("Loja Graça", "Rua da Graça 10"));
    expect(r1).toMatchObject({ id: null, pending: true });
    expect(await prisma.address.count({ where: { companyId: f.companyId, label: "Loja Graça" } })).toBe(0);
    const q = (await A.adminAddressRequests(sa)).find((x) => x.id === r1.requestId)!;
    expect(q).toMatchObject({ action: "CREATE", kind: "DELIVERY", proofKey: null });
    await expect(A.decideAddressRequest(sa, r1.requestId!, true)).rejects.toThrow(/No till invoice/);
    await expect(A.decideAddressRequest(sa, r1.requestId!, false)).rejects.toThrow(/reason/);
    // the company attaches the invoice afterwards (must be recent)
    await expect(A.attachAddressProof(ctx, r1.requestId!, { file: pngFile("talao.png"), issuedOn: new Date(Date.now() - 200 * 86_400_000) })).rejects.toThrow(/recent/);
    await A.attachAddressProof(ctx, r1.requestId!, { file: pngFile("talao.png"), issuedOn: today() });
    const proof = await A.readAddressProof(sa, r1.requestId!);
    expect(proof.mimeType).toBe("image/png");
    await expect(A.readAddressProof(await ctxFor(KH), r1.requestId!)).rejects.toThrow();
    const d1 = await A.decideAddressRequest(sa, r1.requestId!, true);
    const shop = await prisma.address.findUniqueOrThrow({ where: { id: d1.appliedAddressId! } });
    expect(shop).toMatchObject({ label: "Loja Graça", line1: "Rua da Graça 10", isActive: true });
    // a second new address: FIRINGI bypasses the invoice (recorded)
    const r2 = await A.saveAddress(ctx, await addr("Armazém Norte", "Rua do Norte 5"));
    await A.decideAddressRequest(sa, r2.requestId!, true, null, { bypassProof: true });
    expect((await prisma.addressChangeRequest.findUniqueOrThrow({ where: { id: r2.requestId! } })).proofBypassed).toBe(true);
    // same place, new name / contact / phone → at once
    const e1 = await A.saveAddress(ctx, { ...(await addr("Loja da Graça", "Rua da Graça 10")), id: shop.id, contactName: "Rui", phone: "+351911111111" });
    expect(e1).toMatchObject({ id: shop.id, pending: false });
    expect((await prisma.address.findUniqueOrThrow({ where: { id: shop.id } })).label).toBe("Loja da Graça");
    // moved to another street → waits again (with the invoice sent along); refusal tells the company
    const m1 = await A.saveAddress(ctx, { ...(await addr("Loja da Graça", "Rua Nova 99")), id: shop.id }, { proof: { file: pngFile(), issuedOn: today() } });
    expect(m1.pending).toBe(true);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: shop.id } })).line1).toBe("Rua da Graça 10");
    await A.decideAddressRequest(sa, m1.requestId!, false, "The invoice shows another street");
    expect((await A.ownAddressRequests(ctx)).find((x) => x.id === m1.requestId)).toMatchObject({ status: "REJECTED", decisionNote: "The invoice shows another street" });
    // removing an address applies at once
    expect((await A.removeAddress(ctx, shop.id)).pending).toBe(false);
    // the company can withdraw its own open request
    const r3 = await A.saveAddress(ctx, await addr("Quiosque", "Praça 1"));
    await A.cancelAddressRequest(ctx, r3.requestId!);
    expect((await prisma.addressChangeRequest.findUniqueOrThrow({ where: { id: r3.requestId! } })).status).toBe("CANCELLED");
  });

  it("a new shop's address joins the shop once approved; with approval switched off it applies at once", async () => {
    const f = await makeApprovedCompany("CUSTOMER");
    made.push(f.companyId);
    const ctx = await ctxFor(f.email), sa = await ctxFor(SA);
    const branchId = await saveBranch(ctx, null, { name: "Loja Baixa" } as never);
    expect(await addShopAddress(ctx, branchId, await addr("", "Rua Augusta 1"))).toBeNull();
    const req = (await A.ownAddressRequests(ctx))[0];
    expect(req.branchId).toBe(branchId);
    const d = await A.decideAddressRequest(sa, req.id, true, null, { bypassProof: true });
    expect((await prisma.address.findUniqueOrThrow({ where: { id: d.appliedAddressId! } })).branchId).toBe(branchId);
    await A.saveAddressApprovalSettings(sa, { enabled: false, proofRequired: true, kinds: { HEAD_OFFICE: true, BILLING: true, WAREHOUSE: true, PICKUP: true, DELIVERY: true } });
    expect((await A.saveAddress(ctx, await addr("Direto", "Rua 2"))).pending).toBe(false);
    await A.saveAddressApprovalSettings(sa, { enabled: true, proofRequired: true, kinds: { HEAD_OFFICE: true, BILLING: true, WAREHOUSE: true, PICKUP: true, DELIVERY: false } });
    expect((await A.saveAddress(ctx, await addr("Por tipo", "Rua 3"))).pending).toBe(false);
    await A.saveAddressApprovalSettings(sa, { enabled: true, proofRequired: true, kinds: { HEAD_OFFICE: true, BILLING: true, WAREHOUSE: true, PICKUP: true, DELIVERY: true } });
  });

  it("an address printed on till receipts is fixed: no edit, no removal, the till keeps it", async () => {
    const f = await makeApprovedCompany("CUSTOMER");
    made.push(f.companyId);
    const ctx = await ctxFor(f.email);
    const country = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
    const shop = await prisma.address.create({ data: { companyId: f.companyId, kind: "DELIVERY", label: "Café", line1: "Rua do Café 1", postalCode: "1100-001", cityName: "Lisboa", countryId: country.id } });
    const other = await prisma.address.create({ data: { companyId: f.companyId, kind: "DELIVERY", label: "Outra", line1: "Rua 9", postalCode: "1100-001", cityName: "Lisboa", countryId: country.id } });
    const till = await prisma.posRegister.create({ data: { companyId: f.companyId, name: "Caixa café", code: "C1", addressId: shop.id } });
    const shift = await prisma.posShift.create({ data: { registerId: till.id, number: 1, openedById: ctx.user.id } });
    // before any receipt: the till's address can still change
    expect((await A.lockedTillAddressIds(f.companyId)).size).toBe(0);
    await prisma.posSale.create({ data: { companyId: f.companyId, registerId: till.id, shiftId: shift.id, clientId: "t-lock-1", number: "C1-0001-0001", net: 1, vat: 0.23, gross: 1.23, cashierId: ctx.user.id, soldAt: new Date(), hash: "x", receiptToken: `tok-${Date.now()}` } });
    expect([...(await A.lockedTillAddressIds(f.companyId))]).toEqual([shop.id]);
    await expect(A.saveAddress(ctx, { ...(await addr("Café novo", "Rua do Café 1")), id: shop.id })).rejects.toThrow(/till receipts/);
    await expect(A.removeAddress(ctx, shop.id)).rejects.toThrow(/till receipts/);
    await expect(saveRegister(ctx, { id: till.id, name: "Caixa café", code: "C1", addressId: other.id })).rejects.toThrow(/issued receipts/);
  });
});
