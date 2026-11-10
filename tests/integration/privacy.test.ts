/**
 * Phase 11: GDPR — export my data; erasure requests reviewed and anonymised by FIRINGI.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { completeErasure, erasureBlockers, exportMyData, exportUserData, listDataRequests, myErasureRequest, rejectErasure, requestErasure, withdrawErasure } from "@/server/services/privacy";
import { ctxFor } from "../helpers";

afterAll(() => prisma.$disconnect());
const SA = "superadmin@firingi.test";

/** A throw-away employee of Kebab House (so erasing it doesn't break other tests). */
async function tempEmployee() {
  const kebab = await ctxFor("owner@kebabhouse.test");
  const email = `temp-${Date.now()}@kebabhouse.test`;
  const u = await prisma.user.create({ data: { email, name: "Tina Temp", phone: "+351910000001", smsConsentAt: new Date() } });
  const role = await prisma.role.findFirstOrThrow({ where: { key: "BUYER_PURCHASER" } });
  await prisma.membership.create({ data: { userId: u.id, companyId: kebab.company.id, roles: { create: { roleId: role.id } } } });
  await prisma.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: "x" } });
  await prisma.session.create({ data: { userId: u.id, token: `tok-${u.id}`, expiresAt: new Date(Date.now() + 3600_000), ipAddress: "10.1.1.1" } });
  await prisma.notification.create({ data: { userId: u.id, type: "x", title: "Hello Tina" } });
  await prisma.auditLog.create({ data: { actorUserId: u.id, action: "auth.login", entityType: "User", entityId: u.id, ip: "10.1.1.1", userAgent: "UA" } });
  return { u, email };
}

describe("data privacy", () => {
  it("anyone downloads their own data", async () => {
    const ctx = await ctxFor("buyer@kebabhouse.test");
    const data = await exportMyData(ctx);
    expect(data.account.email).toBe("buyer@kebabhouse.test");
    expect(data.account.memberships[0]).toMatchObject({ company: { legalName: "Kebab House Lisboa, Lda" } });
    expect(JSON.stringify(data)).not.toMatch(/password|secret|token/i);
    expect(await prisma.auditLog.count({ where: { actorUserId: ctx.user.id, action: "privacy.exported" } })).toBeGreaterThan(0);
  });

  it("erasure: request → FIRINGI erases → account anonymised, company records kept", async () => {
    const { u, email } = await tempEmployee();
    const ctx = await ctxFor(email);
    await requestErasure(ctx, "Leaving the company");
    await expect(requestErasure(ctx)).rejects.toThrow(/already asked/);
    const req = (await myErasureRequest(ctx))!;
    expect(req.status).toBe("REQUESTED");
    const sa = await ctxFor(SA);
    expect((await listDataRequests(sa, "REQUESTED")).find((r) => r.id === req.id)?.blockers).toEqual([]);
    await completeErasure(sa, req.id, "Done");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after).toMatchObject({ name: "Deleted user", email: `deleted-${u.id}@deleted.invalid`, phone: null, smsConsentAt: null, status: "DISABLED" });
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.membership.count({ where: { userId: u.id, status: "ACTIVE" } })).toBe(0);
    // the append-only audit trail is kept and now points to the anonymised account
    expect(await prisma.auditLog.count({ where: { actorUserId: u.id, action: "auth.login" } })).toBe(1);
    expect((await prisma.dataRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("COMPLETED");
  });

  it("the only owner of a company can't be erased; FIRINGI rejects with a note; requests can be withdrawn", async () => {
    const owner = await ctxFor("owner@ccalmada.test");
    expect((await erasureBlockers(owner.user.id))[0]).toMatch(/Only owner of Cash & Carry Almada/);
    const r = await requestErasure(owner, null);
    const sa = await ctxFor(SA);
    await expect(completeErasure(sa, r.id)).rejects.toThrow(/Only owner/);
    await expect(rejectErasure(sa, r.id, " ")).rejects.toThrow(/Explain/);
    await rejectErasure(sa, r.id, "Make another person owner first.");
    expect(await myErasureRequest(owner)).toMatchObject({ status: "REJECTED", note: "Make another person owner first." });
    await requestErasure(owner, null);
    await withdrawErasure(owner);
    expect((await myErasureRequest(owner))?.status).toBe("WITHDRAWN");
  });

  it("only FIRINGI user managers handle requests and export others' data", async () => {
    await expect(listDataRequests(await ctxFor("owner@lisboacentral.test"))).rejects.toThrow();
    await expect(listDataRequests(await ctxFor("finance@firingi.test"))).rejects.toThrow();
    await expect(exportUserData(await ctxFor("ops@firingi.test"), "buyer@kebabhouse.test")).rejects.toThrow();
    expect((await exportUserData(await ctxFor(SA), "BUYER@kebabhouse.test")).account.email).toBe("buyer@kebabhouse.test");
    const own = await requestErasure(await ctxFor(SA), null);
    await expect(completeErasure(await ctxFor(SA), own.id)).rejects.toThrow(/Someone else/);
    await withdrawErasure(await ctxFor(SA));
  });
});
