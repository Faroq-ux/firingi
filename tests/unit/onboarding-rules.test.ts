import { describe, expect, it } from "vitest";
import { addressMustBeDomestic, blocking, missingForApproval, missingForSubmission, missingRecommended, needsCertificateCode, normaliseCertificateCode, ADMIN_TRANSITIONS, type ReadinessInput } from "@/server/onboarding/rules";
import { sniffMime } from "@/server/services/storage";
import { checkVies, splitVat } from "@/server/services/vies";
import { computeEffectivePermissions } from "@/server/rbac/effective";

const base: ReadinessInput = {
  type: "CUSTOMER", legalForm: "COMPANY",
  documents: [{ type: "POS_INVOICE", status: "PENDING" }],
  addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "DELIVERY", isActive: true }],
  vatNumber: "PT515444448", certificateCode: null, viesValid: false, hasCommission: false,
};
const codes = (m: { code: string }[]) => m.map((x) => x.code);

describe("submission / approval readiness (Phase 28)", () => {
  it("only addresses and the VAT number block submission — no document is required", () => {
    expect(missingForSubmission({ ...base, documents: [] })).toEqual([]);
    const r = missingForSubmission({ ...base, documents: [], addresses: [{ kind: "DELIVERY", isActive: false }], vatNumber: null });
    expect(codes(r).sort()).toEqual(["ADDRESS_MISSING", "ADDRESS_MISSING", "VAT_NUMBER_MISSING"]);
  });
  it("a customer needs one approved POS invoice — waivable by admin", () => {
    expect(missingForApproval(base)).toEqual([{ code: "POS_INVOICE_NOT_APPROVED", waivable: true }]);
    const none = missingForApproval({ ...base, documents: [{ type: "POS_INVOICE", status: "REJECTED" }] });
    expect(none).toEqual([{ code: "POS_INVOICE_MISSING", waivable: true }]);
    expect(missingRecommended({ ...base, documents: [] }).map((m) => m.code)).toEqual(["POS_INVOICE_MISSING"]);
    expect(missingForApproval({ ...base, documents: [{ type: "POS_INVOICE", status: "APPROVED" }] })).toEqual([]);
    expect(blocking(none)).toEqual([]);
  });
  it("customers never need the certificate code; old documents are optional", () => {
    const r = missingForApproval({ ...base, documents: [{ type: "POS_INVOICE", status: "APPROVED" }, { type: "BUSINESS_REGISTRATION", status: "PENDING" }] });
    expect(r).toEqual([]);
  });
  it("supplier companies need the permanent certificate code (waivable); sole traders don't", () => {
    const w: ReadinessInput = { ...base, type: "WHOLESALER", documents: [], addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "WAREHOUSE", isActive: true }], hasCommission: true };
    expect(missingForApproval(w)).toEqual([{ code: "CERTIFICATE_CODE_MISSING", waivable: true }]);
    expect(missingForApproval({ ...w, legalForm: "SOLE_TRADER" })).toEqual([]);
    expect(missingForApproval({ ...w, certificateCode: "1234-5678-9012" })).toEqual([]);
    expect(needsCertificateCode("CUSTOMER", "COMPANY")).toBe(false);
  });
  it("distributor needs VAT number, VIES confirmation and a commission rate — not waivable", () => {
    const d: ReadinessInput = {
      type: "DISTRIBUTOR", legalForm: "COMPANY", documents: [],
      addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "WAREHOUSE", isActive: true }],
      vatNumber: "ESB12345678", certificateCode: "B-12345678", viesValid: false, hasCommission: false,
    };
    const m = missingForApproval(d);
    expect(codes(m)).toEqual(["VIES_NOT_VALID", "COMMISSION_MISSING"]);
    expect(blocking(m)).toHaveLength(2);
    expect(missingForApproval({ ...d, viesValid: true, hasCommission: true })).toEqual([]);
    expect(codes(missingForSubmission({ ...d, vatNumber: null }))).toEqual(["VAT_NUMBER_MISSING"]);
  });
  it("wholesaler needs a warehouse or pickup address", () => {
    const w: ReadinessInput = { ...base, type: "WHOLESALER", addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "DELIVERY", isActive: true }] };
    expect(missingForSubmission(w).map((m) => `${m.code}:${m.detail}`)).toEqual(["ADDRESS_MISSING:WAREHOUSE|PICKUP"]);
  });
  it("normalises the PT permanent certificate code; other countries take a registry number", () => {
    expect(normaliseCertificateCode("123456789012", "PT")).toEqual({ ok: true, code: "1234-5678-9012" });
    expect(normaliseCertificateCode("1234-5678-9012", "PT")).toEqual({ ok: true, code: "1234-5678-9012" });
    expect(normaliseCertificateCode("1234-5678", "PT")).toEqual({ ok: false });
    expect(normaliseCertificateCode("abcd-5678-9012", "PT")).toEqual({ ok: false });
    expect(normaliseCertificateCode("hrb 12345", "DE")).toEqual({ ok: true, code: "HRB 12345" });
    expect(normaliseCertificateCode("x", "DE")).toEqual({ ok: false });
  });
  it("wholesalers and customers are domestic; distributors may have EU warehouses", () => {
    expect(addressMustBeDomestic("WHOLESALER", "WAREHOUSE")).toBe(true);
    expect(addressMustBeDomestic("CUSTOMER", "DELIVERY")).toBe(true);
    expect(addressMustBeDomestic("DISTRIBUTOR", "WAREHOUSE")).toBe(false);
    expect(addressMustBeDomestic("DISTRIBUTOR", "HEAD_OFFICE")).toBe(true);
  });
  it("applicants can never be approved straight from PENDING", () => {
    expect(ADMIN_TRANSITIONS.PENDING).not.toContain("APPROVED");
  });
});

describe("driver permissions", () => {
  const input: Parameters<typeof computeEffectivePermissions>[0] = {
    companyType: "ADMIN", companyStatus: "APPROVED", membershipStatus: "ACTIVE", userStatus: "ACTIVE", isOwner: false,
    roles: [{ key: "ADMIN_DRIVER", isSystem: true, permissionCodes: [] }],
  };
  it("a driver gets driver permissions only once the driver profile is approved", () => {
    expect(computeEffectivePermissions({ ...input, driverStatus: "PENDING" }).size).toBe(0);
    expect(computeEffectivePermissions({ ...input, driverStatus: "APPROVED" }).has("driver.pod.capture")).toBe(true);
  });
});

describe("upload sniffing", () => {
  it("detects real file types and rejects disguised files", () => {
    expect(sniffMime(Buffer.from("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(sniffMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("VIES client", () => {
  const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("splits VAT numbers (incl. Greek EL prefix)", () => {
    expect(splitVat("PT 501 964 843")).toEqual({ countryCode: "PT", number: "501964843" });
    expect(splitVat("EL123456789")).toEqual({ countryCode: "EL", number: "123456789" });
    expect(splitVat("123")).toBeNull();
  });
  it("maps valid / invalid / outage responses", async () => {
    expect((await checkVies("ESB12345678", fake(200, { valid: true, name: "IBERICAS SL", address: "---", requestIdentifier: "WAPI123" })))).toMatchObject({ result: "VALID", registeredName: "IBERICAS SL", registeredAddress: null, consultationRef: "WAPI123" });
    expect((await checkVies("ESB12345678", fake(200, { valid: false }))).result).toBe("INVALID");
    expect((await checkVies("ESB12345678", fake(503, {}))).result).toBe("ERROR");
    expect((await checkVies("ESB12345678", fake(200, { userError: "MS_UNAVAILABLE" }))).result).toBe("ERROR");
    const throwing = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    expect(await checkVies("ESB12345678", throwing)).toMatchObject({ result: "ERROR", error: "network down" });
  });
});
