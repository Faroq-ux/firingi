/**
 * Phase 16: four-eyes approvals — the action waits; a second person with the same right approves
 * (it then runs as requested) or rejects; never the one who asked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setCustomerTerms, setLegalEntityIban } from "@/server/services/payments";
import { saveAdminPromotion } from "@/server/services/promotions";
import * as team from "@/server/services/team";
import { approvalSettings } from "@/server/approvals/gate";
import { decideApproval, listApprovals, saveApprovalSettings, withdrawApproval } from "@/server/approvals/service";
import { ctxFor } from "../helpers";

// Kebab House's credit terms are changed here; put them back so later suites can still order.
let kebabTerms: { creditLimit: unknown; paymentTermsDays: number } | null = null;
beforeAll(async () => { kebabTerms = await prisma.company.findFirstOrThrow({ where: { legalName: "Kebab House Lisboa, Lda" }, select: { creditLimit: true, paymentTermsDays: true } }); });
afterAll(async () => {
  if (kebabTerms) await prisma.company.updateMany({ where: { legalName: "Kebab House Lisboa, Lda" }, data: { creditLimit: kebabTerms.creditLimit as never, paymentTermsDays: kebabTerms.paymentTermsDays } });
  await prisma.$disconnect();
});
const SA = "superadmin@firingi.test", FIN = "finance@firingi.test", SALES = "sales@firingi.test";
const pending = (kind: string) => prisma.approvalRequest.findFirstOrThrow({ where: { kind, status: "PENDING" }, orderBy: { requestedAt: "desc" } });

describe("four-eyes approvals", () => {
  it("raising a credit limit above the threshold waits; the requester can't approve; another holder can", async () => {
    const fin = await ctxFor(FIN), sales = await ctxFor(SALES);
    const kebab = await prisma.company.findFirstOrThrow({ where: { tradeName: "Kebab House" } });
    await setCustomerTerms(fin, kebab.id, 30, 2000); // below the threshold: straight through
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: kebab.id } })).creditLimit)).toBe(2000);
    await expect(setCustomerTerms(fin, kebab.id, 30, 50000)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: kebab.id } })).creditLimit)).toBe(2000); // nothing changed yet
    const r = await pending("CUSTOMER_TERMS");
    expect((await listApprovals(sales)).find((x) => x.id === r.id)).toMatchObject({ canDecide: true });
    expect((await listApprovals(fin)).find((x) => x.id === r.id)).toMatchObject({ canDecide: false, canWithdraw: true });
    await expect(decideApproval(fin, r.id, true, null)).rejects.toThrow(/second person/);
    await expect(decideApproval(sales, r.id, false, "")).rejects.toThrow(/reason/);
    await decideApproval(sales, r.id, true, null);
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: kebab.id } })).creditLimit)).toBe(50000);
    await expect(decideApproval(sales, r.id, true, null)).rejects.toThrow(/already/);
    // back to normal (lowering never needs approval)
    await setCustomerTerms(fin, kebab.id, 30, 2000);
  });

  it("FIRINGI's IBAN always needs a second person with settings rights; rejecting keeps the old one", async () => {
    const sa = await ctxFor(SA);
    const le = await prisma.legalEntity.findFirstOrThrow();
    await expect(setLegalEntityIban(sa, le.id, "not an iban")).rejects.toThrow(/valid IBAN/);
    await expect(setLegalEntityIban(sa, le.id, "PT50 0002 0123 1234 5678 9015 4")).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const r = await pending("BANK_DETAILS");
    // Finance doesn't have settings rights → can't decide
    await expect(decideApproval(await ctxFor(FIN), r.id, false, "no")).rejects.toThrow(/same right/);
    await withdrawApproval(sa, r.id);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
    expect((await prisma.legalEntity.findUniqueOrThrow({ where: { id: le.id } })).iban).toBe(le.iban);
  });

  it("a big FIRINGI-paid coupon waits; small ones and supplier-paid ones don't", async () => {
    const sales = await ctxFor(SALES), sa = await ctxFor(SA);
    const s = await approvalSettings();
    const ok = await saveAdminPromotion(sales, { name: { en: "Small" }, kind: "PERCENT", value: 5, firingiFundPct: 100, validFrom: new Date(), code: `SMALL${Date.now().toString(36).toUpperCase()}`, targets: {} });
    expect(ok.id).toBeTruthy();
    const code = `BIG${Date.now().toString(36).toUpperCase()}`;
    await expect(saveAdminPromotion(sales, { name: { en: "Huge" }, kind: "PERCENT", value: s.offerPercentAbove + 10, firingiFundPct: 100, validFrom: new Date(), code, targets: {} })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(await prisma.promotion.count({ where: { code } })).toBe(0);
    const r = await pending("OFFER");
    const res = await decideApproval(sa, r.id, true, null);
    expect(await prisma.promotion.count({ where: { code } })).toBe(1);
    expect(res.result).toMatchObject({ promotionId: expect.any(String) });
    await prisma.promotion.updateMany({ where: { code: { in: [code] } }, data: { status: "ENDED" } });
    await prisma.promotion.update({ where: { id: ok.id }, data: { status: "ENDED" } });
  });

  it("a new staff member gets ordinary roles now; a powerful role waits for a second person", async () => {
    const sa = await ctxFor(SA);
    const roles = await team.listRoles(sa);
    const id = (k: string) => roles.find((r) => r.key === k)!.id;
    const created = await team.createMember(sa, { name: "Nova Finance", email: `nova.${Date.now()}@firingi.test`, password: "Password123!", roleIds: [id("SUPPORT"), id("FINANCE")] });
    expect(created.approvalId).toBeTruthy();
    const held = await prisma.membershipRole.findMany({ where: { membershipId: created.membershipId }, include: { role: true } });
    expect(held.map((r) => r.role.key)).toEqual(["SUPPORT"]);
    // another holder of users.manage approves (a second super admin)
    const other = await team.createMember(sa, { name: "Second Admin", email: `second.${Date.now()}@firingi.test`, password: "Password123!", roleIds: [] });
    await prisma.membershipRole.create({ data: { membershipId: other.membershipId, roleId: id("SUPER_ADMIN") } });
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: other.membershipId }, include: { user: true } });
    await decideApproval(await ctxFor(m.user.email), created.approvalId!, true, null);
    const after = await prisma.membershipRole.findMany({ where: { membershipId: created.membershipId }, include: { role: true } });
    expect(after.map((r) => r.role.key).sort()).toEqual(["FINANCE", "SUPPORT"]);
  });

  it("only settings managers change the thresholds; switched off, actions run straight away", async () => {
    await expect(saveApprovalSettings(await ctxFor(FIN), { enabled: false })).rejects.toThrow();
    const sa = await ctxFor(SA);
    const before = await approvalSettings();
    try {
      await saveApprovalSettings(sa, { enabled: false });
      const kebab = await prisma.company.findFirstOrThrow({ where: { tradeName: "Kebab House" } });
      await setCustomerTerms(await ctxFor(FIN), kebab.id, 30, 60000);
      expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: kebab.id } })).creditLimit)).toBe(60000);
      await setCustomerTerms(await ctxFor(FIN), kebab.id, 30, 2000);
    } finally { await saveApprovalSettings(sa, before); }
  });
});
