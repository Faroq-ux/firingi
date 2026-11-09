import { describe, expect, it } from "vitest";
import { addressMustBeDomestic, missingForApproval, missingForSubmission, ADMIN_TRANSITIONS, type ReadinessInput } from "@/server/onboarding/rules";
import { sniffMime } from "@/server/services/storage";
import { checkVies, splitVat } from "@/server/services/vies";
import { computeEffectivePermissions } from "@/server/rbac/effective";

const base: ReadinessInput = {
  type: "CUSTOMER",
  documents: [{ type: "BUSINESS_REGISTRATION", status: "PENDING" }, { type: "TAX_ID_CERTIFICATE", status: "PENDING" }],
  addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "DELIVERY", isActive: true }],
  vatNumber: null, viesValid: false, hasCommission: false,
};

describe("submission / approval readiness", () => {
  it("customer with docs uploaded and addresses can submit but not yet be approved", () => {
    expect(missingForSubmission(base)).toEqual([]);
    expect(missingForApproval(base).map((m) => m.code)).toEqual(["DOCUMENT_NOT_APPROVED", "DOCUMENT_NOT_APPROVED"]);
  });
  it("rejected documents and inactive addresses don't count", () => {
    const r = missingForSubmission({ ...base, documents: [{ type: "BUSINESS_REGISTRATION", status: "REJECTED" }], addresses: [{ kind: "DELIVERY", isActive: false }] });
    expect(r.map((m) => m.code).sort()).toEqual(["ADDRESS_MISSING", "ADDRESS_MISSING", "DOCUMENT_MISSING", "DOCUMENT_MISSING"]);
  });
  it("distributor needs VAT number, VIES confirmation and a commission rate", () => {
    const d: ReadinessInput = {
      type: "DISTRIBUTOR",
      documents: [{ type: "BUSINESS_REGISTRATION", status: "APPROVED" }, { type: "TAX_ID_CERTIFICATE", status: "APPROVED" }],
      addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "WAREHOUSE", isActive: true }],
      vatNumber: "ESB12345678", viesValid: false, hasCommission: false,
    };
    expect(missingForApproval(d).map((m) => m.code)).toEqual(["VIES_NOT_VALID", "COMMISSION_MISSING"]);
    expect(missingForApproval({ ...d, viesValid: true, hasCommission: true })).toEqual([]);
    expect(missingForSubmission({ ...d, vatNumber: null }).map((m) => m.code)).toEqual(["VAT_NUMBER_MISSING"]);
  });
  it("wholesaler also needs a trade licence and a warehouse or pickup address", () => {
    const w: ReadinessInput = { ...base, type: "WHOLESALER", addresses: [{ kind: "HEAD_OFFICE", isActive: true }, { kind: "DELIVERY", isActive: true }] };
    expect(missingForSubmission(w).map((m) => `${m.code}:${m.detail}`)).toEqual(["DOCUMENT_MISSING:TRADE_LICENCE", "ADDRESS_MISSING:WAREHOUSE|PICKUP"]);
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
